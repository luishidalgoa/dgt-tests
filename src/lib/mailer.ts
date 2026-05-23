/**
 * Mailer único centralizado. Por debajo: nodemailer + SMTP de Gmail.
 *
 * Env vars necesarias:
 *   GMAIL_USER          → tu cuenta gmail (p.ej. luis.x@gmail.com)
 *   GMAIL_APP_PASSWORD  → contraseña de aplicación de 16 chars
 *                         (Google → Cuenta → Seguridad → 2FA →
 *                          Contraseñas de aplicaciones)
 *   GMAIL_FROM          → opcional, sender bonito tipo
 *                         "DGT Tests <luis.x@gmail.com>". Si vacío,
 *                         usa GMAIL_USER directo.
 *
 * Si las dos primeras no están definidas, sendMail() loguea y devuelve
 * false sin crashear (modo dev sin emails configurados).
 *
 * Decisión: Gmail SMTP en lugar de Resend porque no requiere
 * verificación de dominio para enviar a cualquier address. Límite
 * práctico ~500 emails/día por cuenta gratuita (suficiente para
 * webhooks de billing en escala media).
 *
 * El transporter se cachea entre llamadas (un solo socket pool).
 * Para tests existe _resetMailerForTests().
 */
import nodemailer from "nodemailer"
import type { Transporter } from "nodemailer"
import { getEffectiveSecret } from "@/lib/secretCatalog"
import { captureAppException } from "@/lib/sentryUser"
import { shouldNotifyOnce } from "@/lib/sentryThrottle"

/**
 * Códigos de error SISTÉMICOS de nodemailer/Gmail SMTP — el mismo
 * error se reproducirá en cada send hasta que se arregle la config
 * o vuelva el servicio. Aplicamos throttle (1 evento por 30min) para
 * no spamear Sentry con 200 eventos idénticos durante un fallo.
 *
 *   EAUTH       → password incorrecto / 2FA cambió / app password revocada
 *   ECONNECTION → no podemos conectar a smtp.gmail.com (red, DNS, firewall)
 *   ETIMEDOUT   → conexión abierta pero Gmail no responde (rate limit
 *                 oculto, servidor sobrecargado)
 *
 * Códigos PER-EMAIL (no throttle, queremos cada uno):
 *   EENVELOPE   → email destinatario mal formateado / rebotado por Gmail
 *   EMESSAGE    → mensaje rechazado (spam, demasiado grande)
 *   ESTREAM     → fallo al leer body, raro
 */
const SYSTEMIC_SMTP_CODES = new Set(["EAUTH", "ECONNECTION", "ETIMEDOUT"])

let _transporter: Transporter | null = null

async function getTransporter(): Promise<Transporter | null> {
  if (_transporter) return _transporter
  const user = process.env.GMAIL_USER
  // GMAIL_APP_PASSWORD pasa por el helper: BBDD (cifrado) gana, fallback env.
  const pass = await getEffectiveSecret("GMAIL_APP_PASSWORD")
  if (!user || !pass) return null
  _transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  })
  return _transporter
}

/** Solo para tests: invalida el cache del transporter. */
export function _resetMailerForTests(): void {
  _transporter = null
}

export interface SendMailOpts {
  to:      string
  subject: string
  html:    string
  /** Override del sender. Si no se pasa, usa GMAIL_FROM o GMAIL_USER. */
  from?:   string
}

/**
 * Envía un email. Devuelve true si SMTP aceptó la entrega, false en
 * cualquier otro caso (sin config, error de transporte, etc.).
 *
 * No lanza excepciones — los handlers de webhook pueden ignorar el
 * resultado tranquilamente.
 */
export async function sendMail(opts: SendMailOpts): Promise<boolean> {
  const transporter = await getTransporter()
  if (!transporter) {
    console.warn(
      "[mailer] GMAIL_USER/GMAIL_APP_PASSWORD no configurados — email omitido:",
      opts.subject,
      "→",
      opts.to
    )
    return false
  }

  const from = opts.from
    ?? process.env.GMAIL_FROM
    ?? process.env.GMAIL_USER!

  try {
    await transporter.sendMail({
      from,
      to:      opts.to,
      subject: opts.subject,
      html:    opts.html,
    })
    return true
  } catch (err) {
    console.error("[mailer] error enviando email:", err)
    // Sentry: el caller (webhook de payment_failed, recovery email, etc.)
    // hace fire-and-forget e ignora el `false` que devolvemos. Sin Sentry
    // los emails fallidos serían silenciosos.
    const code          = (err as { code?: string })?.code ?? "unknown"
    const isSystemic    = SYSTEMIC_SMTP_CODES.has(code)
    // Throttle: si Gmail se cae o se cambió la app password, los próximos
    // 200 emails fallarán todos con el MISMO código → 1 evento basta.
    // Per-email (EENVELOPE etc.) siempre capturamos para diagnosticar
    // emails inválidos concretos.
    const shouldCapture = !isSystemic || shouldNotifyOnce(`mailer:gmail:${code}`)
    if (shouldCapture) {
      const recipientHash = await hashEmailForLog(opts.to)
      captureAppException(err, {
        category: "email",
        tags: {
          provider:  "gmail-smtp",
          errorCode: code,
        },
        extra: {
          subject:       opts.subject,
          recipientHash, // sha256 del email destinatario, sin PII plano
          throttled:     isSystemic ? "first-in-30min" : "no",
        },
        // Sistémicos = warning (condición temporal infra).
        // Per-email = error (algo concreto que se debería arreglar).
        level:       isSystemic ? "warning" : "error",
        fingerprint: isSystemic ? ["mailer-systemic", "gmail", code] : undefined,
      })
    }
    return false
  }
}

/** sha256 del email para correlación sin enviar el email plano a Sentry. */
async function hashEmailForLog(email: string): Promise<string> {
  try {
    const crypto = await import("node:crypto")
    return crypto.createHash("sha256").update(email.toLowerCase().trim()).digest("hex").slice(0, 16)
  } catch {
    return "unknown"
  }
}
