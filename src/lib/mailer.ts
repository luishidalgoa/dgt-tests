/**
 * Mailer único centralizado. Por debajo: nodemailer + SMTP de Resend.
 *
 * Configuración:
 *   RESEND_API_KEY  → (SECRETO, /admin/secrets o env) API key de Resend
 *                     con "Sending access". Hace de contraseña SMTP.
 *                     Sin ella, sendMail() loguea y devuelve false sin
 *                     crashear (modo dev sin emails configurados).
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / MAIL_FROM → editables en caliente
 *                     desde /admin (categoría Integraciones) o por env var
 *                     del mismo nombre. Defaults = Resend
 *                     (smtp.resend.com : 465, user "resend",
 *                      from "DGT-TESTS <noreply@hdglabs.com>").
 *                     El dominio del from DEBE estar verificado en el
 *                     proveedor SMTP (DKIM/SPF).
 *
 * Los getters de config se leen con try/catch: si la BBDD está caída
 * caemos a los defaults sin lanzar (el mailer es fire-and-forget).
 *
 * Decisión: Resend en lugar de Gmail SMTP para poder enviar con
 * remitente del dominio propio verificado (noreply@hdglabs.com) en vez
 * de una cuenta gmail. Resend expone SMTP estándar (smtp.resend.com),
 * así que reutilizamos nodemailer y todo el manejo de errores SMTP.
 *
 * El transporter se cachea entre llamadas (un solo socket pool).
 * Para tests existe _resetMailerForTests().
 */
import nodemailer from "nodemailer"
import type { Transporter } from "nodemailer"
import { getEffectiveSecret } from "@/lib/secretCatalog"
import { getMailFrom, getSmtpHost, getSmtpPort, getSmtpUser } from "@/lib/configCatalog"
import { captureAppException } from "@/lib/sentryUser"
import { shouldNotifyOnce } from "@/lib/sentryThrottle"

/**
 * Defaults de último recurso si la BBDD está caída al leer la config
 * (los getters de configCatalog ya aplican BBDD → env → estos valores,
 * pero si la query de BBDD lanza los usamos directamente).
 */
const DEFAULT_FROM = "DGT-TESTS <noreply@hdglabs.com>"
const DEFAULT_HOST = "smtp.resend.com"
const DEFAULT_PORT = 465
const DEFAULT_USER = "resend"

/**
 * Códigos de error SISTÉMICOS de nodemailer/SMTP — el mismo error se
 * reproducirá en cada send hasta que se arregle la config o vuelva el
 * servicio. Aplicamos throttle (1 evento por 30min) para no spamear
 * Sentry con 200 eventos idénticos durante un fallo.
 *
 *   EAUTH       → API key incorrecta / revocada / sin permiso de envío
 *   ECONNECTION → no podemos conectar a smtp.resend.com (red, DNS, firewall)
 *   ETIMEDOUT   → conexión abierta pero Resend no responde (rate limit
 *                 oculto, servidor sobrecargado)
 *
 * Códigos PER-EMAIL (no throttle, queremos cada uno):
 *   EENVELOPE   → email destinatario mal formateado / rebotado
 *   EMESSAGE    → mensaje rechazado (spam, demasiado grande)
 *   ESTREAM     → fallo al leer body, raro
 */
const SYSTEMIC_SMTP_CODES = new Set(["EAUTH", "ECONNECTION", "ETIMEDOUT"])

let _transporter: Transporter | null = null

async function getTransporter(): Promise<Transporter | null> {
  if (_transporter) return _transporter
  // RESEND_API_KEY pasa por el helper: BBDD (cifrado) gana, fallback env.
  const apiKey = await getEffectiveSecret("RESEND_API_KEY")
  if (!apiKey) return null

  // Host/puerto/usuario son editables desde /admin (categoría Integraciones).
  // Nunca dejamos que un fallo de BBDD tumbe el mailer → fallback a defaults.
  let host = DEFAULT_HOST
  let port = DEFAULT_PORT
  let user = DEFAULT_USER
  try {
    const [h, p, u] = await Promise.all([getSmtpHost(), getSmtpPort(), getSmtpUser()])
    host = h
    port = p
    user = u
  } catch {
    // BBDD inaccesible → seguimos con los defaults de Resend.
  }

  _transporter = nodemailer.createTransport({
    host,
    port,
    // 465 = TLS implícito; 587/2587 = STARTTLS (secure=false + upgrade).
    secure: port === 465,
    auth:   { user, pass: apiKey },
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
  /** Override del sender. Si no se pasa, usa MAIL_FROM o DEFAULT_FROM. */
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
      "[mailer] RESEND_API_KEY no configurada — email omitido:",
      opts.subject,
      "→",
      opts.to
    )
    return false
  }

  // Remitente: override per-email > MAIL_FROM (/admin o env) > default.
  let from = opts.from
  if (!from) {
    try {
      from = await getMailFrom()
    } catch {
      from = DEFAULT_FROM
    }
  }

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
    // Throttle: si Resend se cae o se revocó la API key, los próximos
    // 200 emails fallarán todos con el MISMO código → 1 evento basta.
    // Per-email (EENVELOPE etc.) siempre capturamos para diagnosticar
    // emails inválidos concretos.
    const shouldCapture = !isSystemic || shouldNotifyOnce(`mailer:resend:${code}`)
    if (shouldCapture) {
      const recipientHash = await hashEmailForLog(opts.to)
      captureAppException(err, {
        category: "email",
        tags: {
          provider:  "resend-smtp",
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
        fingerprint: isSystemic ? ["mailer-systemic", "resend", code] : undefined,
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
