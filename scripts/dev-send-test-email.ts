/**
 * Envía un email de prueba al user indicado usando los composers reales.
 * Útil para validar templates + integración con Resend sin pasar por el
 * flujo completo de Stripe.
 *
 *   npm run dev:send-test-email -- <username> <upcoming|failed>
 *
 * Ejemplo:
 *   npm run dev:send-test-email -- luishidalgoa upcoming
 */
import { db } from "@/lib/db"
import {
  composeInvoiceUpcomingEmail,
  composePaymentFailedEmail,
  sendUserEmail,
} from "@/lib/userEmails"

async function main() {
  const [username, kind] = process.argv.slice(2)
  if (!username || !(kind === "upcoming" || kind === "failed")) {
    console.error("Uso: dev-send-test-email.ts <username> <upcoming|failed>")
    process.exit(1)
  }

  const user = await db.user.findUnique({ where: { username } })
  if (!user) {
    console.error(`✗ No existe '${username}'`)
    process.exit(1)
  }
  if (!user.email) {
    console.error(`✗ '${username}' no tiene email guardado`)
    process.exit(1)
  }

  console.log(`👤 Destinatario: ${user.username} <${user.email}>`)
  console.log(`📧 Tipo: ${kind}`)
  console.log(`📤 From: ${process.env.MAIL_FROM ?? "DGT-TESTS <noreply@hdglabs.com>"}`)

  const nextRenewalTs = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
  const portalUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/settings`
    : "http://localhost:4321/settings"

  const composed =
    kind === "upcoming"
      ? composeInvoiceUpcomingEmail(
          { username: user.username, displayName: user.displayName, email: user.email },
          {
            amountCents:    699,
            currency:       "eur",
            willChargeOnTs: nextRenewalTs,
            portalUrl,
          }
        )
      : composePaymentFailedEmail(
          { username: user.username, displayName: user.displayName, email: user.email },
          {
            amountCents:    699,
            currency:       "eur",
            nextAttemptTs:  Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60,
            attemptCount:   1,
            portalUrl,
          }
        )

  console.log(`📋 Subject: ${composed.subject}`)
  console.log()

  const ok = await sendUserEmail({ to: user.email, subject: composed.subject, html: composed.html })
  if (ok) {
    console.log("✅ Email aceptado por el SMTP de Resend.")
    console.log("   Si no llega, revisa la carpeta de spam.")
  } else {
    console.error("❌ El SMTP rechazó el envío o el mailer no está configurado — revisa logs arriba.")
    process.exit(1)
  }
}

main()
  .catch((e) => { console.error("❌", e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
