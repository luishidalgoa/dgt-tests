/**
 * Envía un email de prueba con la misma plantilla que las alertas de Turso,
 * para verificar que RESEND_API_KEY y ALERT_EMAIL están bien configurados.
 *
 *   npx tsx --env-file=.env scripts/test-email.ts
 */

async function main() {
  const apiKey = process.env.RESEND_API_KEY
  const to     = process.env.ALERT_EMAIL
  const from   = process.env.ALERT_FROM ?? "DGT Tests Alerts <onboarding@resend.dev>"

  console.log("Configuración:")
  console.log("  RESEND_API_KEY:", apiKey ? `${apiKey.slice(0, 8)}…` : "(no definida)")
  console.log("  ALERT_EMAIL:   ", to ?? "(no definido)")
  console.log("  ALERT_FROM:    ", from)
  console.log()

  if (!apiKey || !to) {
    console.error("✗ Falta RESEND_API_KEY o ALERT_EMAIL en .env")
    process.exit(1)
  }

  const ts = new Date().toISOString()

  console.log("📧 Enviando email de prueba a:", to)
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to:      [to],
      subject: "✅ DGT Tests · prueba de email (alertas Resend)",
      html: `
        <h2 style="font-family: system-ui, sans-serif;">¡Funciona! 🎉</h2>
        <p style="font-family: system-ui, sans-serif;">
          Si recibes este email es porque tu integración con Resend está
          correctamente configurada. Las alertas reales (cuando Turso supere
          la cuota mensual) llegarán a este mismo buzón con un asunto similar
          a <code>🚨 DGT Tests · cuota de Turso excedida</code>.
        </p>
        <ul style="font-family: system-ui, sans-serif;">
          <li><b>Cuándo:</b> ${ts}</li>
          <li><b>Entorno:</b> ${process.env.NODE_ENV ?? "local"}</li>
          <li><b>From:</b> ${from}</li>
        </ul>
        <p style="font-family: system-ui, sans-serif; color: #888; font-size: 12px;">
          Este email se envió ejecutando <code>scripts/test-email.ts</code> manualmente.
          No es ninguna alerta real.
        </p>
      `,
    }),
  })

  const body = await res.text()
  console.log()
  console.log(`HTTP ${res.status} ${res.statusText}`)
  console.log(body)

  if (!res.ok) {
    console.error("\n✗ El envío falló. Revisa la API key, el dominio del sender o el plan de Resend.")
    process.exit(1)
  }
  try {
    const json = JSON.parse(body) as { id?: string }
    console.log(`\n✅ Email enviado correctamente. ID: ${json.id ?? "(sin id)"}`)
    console.log(`   Comprueba la bandeja de entrada de ${to}.`)
  } catch {
    console.log("\n✅ Email enviado (respuesta no-JSON, pero status OK).")
  }
}

main().catch((err) => {
  console.error("❌ Error inesperado:", err)
  process.exit(1)
})
