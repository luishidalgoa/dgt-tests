/**
 * Smoke test de Stripe: comprueba que la STRIPE_SECRET_KEY conecta y
 * lista los productos/precios existentes para que cojas el price_id
 * correcto en STRIPE_PRICE_ID.
 *
 *   npx tsx --env-file=.env scripts/test-stripe.ts
 *
 * NO cobra nada — solo lee.
 */
import Stripe from "stripe"

async function main() {
  const apiKey = process.env.STRIPE_SECRET_KEY
  if (!apiKey) {
    console.error("✗ STRIPE_SECRET_KEY no definida en .env")
    process.exit(1)
  }

  const mode = apiKey.startsWith("sk_live_") ? "LIVE 🔴" : "TEST 🟢"
  console.log(`📡 Conectando a Stripe (${mode})...`)

  const stripe = new Stripe(apiKey)

  // 1. Verificar credenciales con un GET /balance (no requiere id)
  try {
    const balance = await stripe.balance.retrieve()
    console.log(`✓ Conexión OK · Balance disponible:`)
    if (balance.available.length === 0) {
      console.log(`    (0)`)
    } else {
      for (const b of balance.available) {
        console.log(`    ${(b.amount / 100).toFixed(2)} ${b.currency.toUpperCase()}`)
      }
    }
    // Info de la cuenta vía REST directo (la firma TS de retrieve() exige id)
    try {
      const res = await fetch("https://api.stripe.com/v1/account", {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (res.ok) {
        const account = (await res.json()) as {
          id?: string
          email?: string
          country?: string
          charges_enabled?: boolean
          payouts_enabled?: boolean
          business_profile?: { name?: string }
        }
        console.log(`  Cuenta: ${account.business_profile?.name ?? account.id ?? "—"}`)
        console.log(`  Email:  ${account.email ?? "—"}`)
        console.log(`  País:   ${account.country ?? "—"}`)
        console.log(`  Charges enabled: ${account.charges_enabled ? "✅" : "❌"}`)
        console.log(`  Payouts enabled: ${account.payouts_enabled ? "✅" : "❌"}`)
      }
    } catch {
      // no bloqueante
    }
  } catch (err) {
    console.error("❌ Error conectando a Stripe:", err instanceof Error ? err.message : err)
    process.exit(1)
  }

  // 2. Listar productos + sus precios
  console.log()
  console.log("📦 Productos en tu cuenta:")
  const products = await stripe.products.list({ limit: 20, active: true })
  if (products.data.length === 0) {
    console.log("  (ninguno)")
    console.log()
    console.log("→ Crea el producto en https://dashboard.stripe.com/products")
    console.log("  • Nombre: DGT Tests PRO")
    console.log("  • Precio: 5,00 EUR / mes (recurring)")
    console.log("  Luego copia el price_... aquí en STRIPE_PRICE_ID")
    return
  }

  for (const p of products.data) {
    console.log(`\n  📦 ${p.name} (${p.id})`)
    const prices = await stripe.prices.list({ product: p.id, limit: 10 })
    for (const price of prices.data) {
      const amount = (price.unit_amount ?? 0) / 100
      const interval = price.recurring?.interval ?? "one-time"
      const active = price.active ? "" : " (inactive)"
      console.log(`     💶 ${amount.toFixed(2)} ${price.currency.toUpperCase()} · ${interval} · ${price.id}${active}`)
    }
  }

  // 3. ¿STRIPE_PRICE_ID está configurado y existe?
  console.log()
  const priceId = process.env.STRIPE_PRICE_ID
  if (!priceId) {
    console.log("⚠ STRIPE_PRICE_ID no está definido todavía.")
    console.log("  Copia uno de los price_... de arriba al .env.")
  } else {
    try {
      const price = await stripe.prices.retrieve(priceId)
      console.log(`✓ STRIPE_PRICE_ID válido: ${price.id} → ${(price.unit_amount ?? 0) / 100} ${price.currency.toUpperCase()}/${price.recurring?.interval ?? "one-time"}`)
    } catch (err) {
      console.log(`❌ STRIPE_PRICE_ID '${priceId}' no existe en esta cuenta:`, err instanceof Error ? err.message : err)
    }
  }

  // 4. Webhooks configurados en el dashboard
  console.log()
  console.log("🪝 Webhooks REGISTRADOS en Stripe Dashboard:")
  const hooks = await stripe.webhookEndpoints.list({ limit: 20 })
  if (hooks.data.length === 0) {
    console.log("  (ninguno)")
  } else {
    for (const h of hooks.data) {
      console.log(`  • ${h.url} (${h.status})`)
      console.log(`    eventos: ${h.enabled_events.join(", ").slice(0, 100)}${h.enabled_events.length > 5 ? "…" : ""}`)
    }
  }

  // 5. STRIPE_WEBHOOK_SECRET local (el que verifica la firma cuando llega un evento)
  console.log()
  console.log("🔐 STRIPE_WEBHOOK_SECRET en este entorno:")
  const whsec = process.env.STRIPE_WEBHOOK_SECRET
  if (!whsec || whsec.trim() === "") {
    console.log("  ❌ vacío")
    console.log("  → Para LOCAL test: arranca `stripe listen --forward-to http://localhost:4321/api/webhooks/stripe`")
    console.log("    y pega el whsec_... que te imprime en .env.local")
    console.log("  → Para producción: coge el de https://dashboard.stripe.com/webhooks (modo live)")
  } else if (!whsec.startsWith("whsec_")) {
    console.log(`  ⚠ formato sospechoso (no empieza por whsec_): ${whsec.slice(0, 10)}…`)
  } else {
    console.log(`  ✓ definido (${whsec.slice(0, 12)}…)`)
    const isLiveKey = apiKey.startsWith("sk_live_")
    console.log()
    if (isLiveKey) {
      console.log("  Notas:")
      console.log("  • Estás en LIVE mode → este secret debe ser el del webhook LIVE de tu Dashboard.")
    } else {
      console.log("  Notas:")
      console.log("  • Estás en TEST mode → este secret debe ser:")
      console.log("    - el temporal que imprime Stripe CLI al hacer `stripe listen`, O")
      console.log("    - el del webhook test del Dashboard (si tienes uno apuntando a una URL")
      console.log("      accesible públicamente, p.ej. ngrok o tu Vercel preview).")
      console.log("  • Si NO coincide con el origen real de los eventos, /api/webhooks/stripe")
      console.log("    devolverá 400 (firma inválida) y la BBDD no se actualizará.")
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
