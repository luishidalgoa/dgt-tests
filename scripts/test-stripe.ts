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

  // 1. Verificar credenciales pidiendo info de la cuenta
  try {
    const account = await stripe.accounts.retrieve()
    console.log(`✓ Conexión OK · Cuenta: ${account.business_profile?.name ?? account.id}`)
    console.log(`  Email: ${account.email ?? "—"}`)
    console.log(`  País:  ${account.country ?? "—"}`)
    console.log(`  Charges enabled:    ${account.charges_enabled ? "✅" : "❌"}`)
    console.log(`  Payouts enabled:    ${account.payouts_enabled ? "✅" : "❌"}`)
    if (!account.charges_enabled) {
      console.log(`  ⚠ Para aceptar pagos tienes que completar el onboarding en`)
      console.log(`     https://dashboard.stripe.com/settings/account`)
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

  // 4. Webhooks configurados
  console.log()
  console.log("🪝 Webhooks configurados:")
  const hooks = await stripe.webhookEndpoints.list({ limit: 20 })
  if (hooks.data.length === 0) {
    console.log("  (ninguno)")
    console.log()
    console.log("→ Crea el webhook en https://dashboard.stripe.com/webhooks")
    console.log("  • Endpoint URL: https://TU-DOMINIO/api/webhooks/stripe")
    console.log("  • Eventos: checkout.session.completed,")
    console.log("            customer.subscription.created,")
    console.log("            customer.subscription.updated,")
    console.log("            customer.subscription.deleted")
    console.log("  Luego copia el whsec_... aquí en STRIPE_WEBHOOK_SECRET")
  } else {
    for (const h of hooks.data) {
      console.log(`  • ${h.url} (${h.status})`)
      console.log(`    eventos: ${h.enabled_events.join(", ").slice(0, 100)}${h.enabled_events.length > 5 ? "…" : ""}`)
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
