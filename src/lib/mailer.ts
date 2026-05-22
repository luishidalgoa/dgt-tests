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
    return false
  }
}
