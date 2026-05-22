/**
 * Emails al USUARIO (no al admin) por eventos de su suscripción.
 *
 * Estilo: composers puros que devuelven { subject, html }, separados
 * del sender que hace I/O contra Resend. Así los composers son
 * testeables sin mocks pesados.
 *
 * Se envían vía Resend igual que las alertas admin (src/lib/alerts.ts),
 * pero el `to` es el email del user, no ALERT_EMAIL.
 *
 * Si el user no tiene email guardado, se omite (logging).
 */

const APP_NAME    = "DGT Tests"
const APP_BRAND_COLOR = "#f97316" // orange-500

export interface ComposedEmail {
  subject: string
  html:    string
}

/** Datos mínimos del user que necesitan los composers. */
export interface UserForEmail {
  username:    string
  displayName: string | null
  email:       string | null
}

interface PaymentFailedData {
  amountCents:    number       // p.ej. 699 = 6,99 €
  currency:       string       // "eur"
  nextAttemptTs:  number | null  // epoch segundos, null si Stripe no reintenta más
  attemptCount:   number
  portalUrl:      string       // URL para gestionar billing
}

interface InvoiceUpcomingData {
  amountCents:    number
  currency:       string
  willChargeOnTs: number       // epoch segundos cuando Stripe cobrará
  portalUrl:      string
}

function formatMoney(cents: number, currency: string): string {
  const value = (cents / 100).toLocaleString("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const symbol = currency.toLowerCase() === "eur" ? " €" : ` ${currency.toUpperCase()}`
  return value + symbol
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

function nameOf(user: UserForEmail): string {
  return user.displayName?.trim() || user.username
}

function wrap(body: string): string {
  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937; line-height: 1.55;">
  <div style="background: ${APP_BRAND_COLOR}; color: white; padding: 18px 24px; border-radius: 12px 12px 0 0; font-weight: 800; font-size: 18px;">
    ${APP_NAME}
  </div>
  <div style="border: 1px solid #e5e7eb; border-top: 0; border-radius: 0 0 12px 12px; padding: 24px;">
    ${body}
  </div>
  <p style="font-size: 11px; color: #9ca3af; text-align: center; margin-top: 16px;">
    Recibes este email porque tienes una suscripción activa en ${APP_NAME}.
  </p>
</div>
  `.trim()
}

/** Email cuando un cobro de renovación falla y Stripe va a reintentar. */
export function composePaymentFailedEmail(
  user: UserForEmail,
  data: PaymentFailedData
): ComposedEmail {
  const money = formatMoney(data.amountCents, data.currency)
  const next = data.nextAttemptTs ? formatDate(data.nextAttemptTs) : null

  const body = `
    <h2 style="margin: 0 0 12px; font-size: 22px;">Tu pago no se ha podido procesar</h2>
    <p>Hola ${nameOf(user)},</p>
    <p>
      No hemos podido cobrar tu suscripción de <b>${money}</b>
      (intento <b>${data.attemptCount}</b>).
      ${next ? `Lo volveremos a intentar el <b>${next}</b>.` : "No haremos más intentos."}
    </p>
    <p>
      <b>Mientras tanto sigues con acceso PRO</b>, pero te recomendamos actualizar
      tu método de pago para evitar que la suscripción se cancele.
    </p>
    <p style="margin: 24px 0;">
      <a href="${data.portalUrl}"
         style="background: ${APP_BRAND_COLOR}; color: white; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 700;">
        Actualizar método de pago →
      </a>
    </p>
    <p style="font-size: 13px; color: #6b7280;">
      Si crees que esto es un error, responde a este email y te ayudaremos.
    </p>
  `

  return {
    subject: `⚠ Tu cobro de ${money} no se ha podido procesar — actualiza tu tarjeta`,
    html:    wrap(body),
  }
}

/** Email pre-renovación, ~1 día antes del próximo cobro. */
export function composeInvoiceUpcomingEmail(
  user: UserForEmail,
  data: InvoiceUpcomingData
): ComposedEmail {
  const money = formatMoney(data.amountCents, data.currency)
  const when  = formatDate(data.willChargeOnTs)

  const body = `
    <h2 style="margin: 0 0 12px; font-size: 22px;">Próxima renovación: ${when}</h2>
    <p>Hola ${nameOf(user)},</p>
    <p>
      Te recordamos que el <b>${when}</b> renovaremos tu suscripción PRO
      cobrando <b>${money}</b> en el método de pago que tienes asociado.
    </p>
    <p>
      Si no quieres renovar, puedes cancelar antes desde el portal de gestión
      y mantendrás el acceso PRO hasta la fecha de fin del periodo actual.
    </p>
    <p style="margin: 24px 0;">
      <a href="${data.portalUrl}"
         style="background: ${APP_BRAND_COLOR}; color: white; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 700;">
        Gestionar suscripción →
      </a>
    </p>
    <p style="font-size: 13px; color: #6b7280;">
      Este aviso se envía 1 día antes del cobro automático.
    </p>
  `

  return {
    subject: `Próxima renovación PRO: ${money} el ${when}`,
    html:    wrap(body),
  }
}

/**
 * Envía un email al user. Wrapper finísimo del mailer central.
 *
 * Devuelve true si el SMTP aceptó la entrega, false en cualquier otro
 * caso (sin config, error de transporte, etc.). No lanza.
 */
export async function sendUserEmail(opts: {
  to:      string
  subject: string
  html:    string
}): Promise<boolean> {
  // Import dinámico para mantener desacoplado el resto del módulo, que
  // es 100% puro (los composers). Así los tests de los composers no
  // arrastran al mailer.
  const { sendMail } = await import("@/lib/mailer")
  return sendMail(opts)
}
