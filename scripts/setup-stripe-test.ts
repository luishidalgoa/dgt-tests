/**
 * Crea (o reutiliza) el producto "DGT Tests PRO" + un Price recurrente
 * mensual de 5€ EN MODO TEST, e imprime el price_id resultante para que
 * lo pegues en .env.local como STRIPE_PRICE_ID.
 *
 * Idempotente: si ya hay un producto con el mismo nombre y un price
 * recurrente de 5,00 EUR / mes activo, lo reutiliza.
 *
 *   STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/setup-stripe-test.ts
 *
 * O simplemente, si en tu .env.local ya tienes la sk_test_:
 *   npx tsx --env-file=.env.local scripts/setup-stripe-test.ts
 */
import Stripe from "stripe"

const PRODUCT_NAME = "DGT Tests PRO"
const TARGET_AMOUNT = 500            // 5,00 EUR en céntimos
const TARGET_CURRENCY = "eur"
const TARGET_INTERVAL = "month"

async function main() {
  const apiKey = process.env.STRIPE_SECRET_KEY
  if (!apiKey) {
    console.error("✗ STRIPE_SECRET_KEY no definida (debe ser sk_test_...)")
    process.exit(1)
  }
  if (!apiKey.startsWith("sk_test_")) {
    console.error(`⚠ La key empieza por '${apiKey.slice(0, 8)}' — esperaba sk_test_.`)
    console.error("  Este script SOLO debe correr en TEST mode.")
    process.exit(1)
  }

  const stripe = new Stripe(apiKey)
  console.log("📡 Stripe TEST mode")

  // 1. Buscar/crear el producto
  let product: Stripe.Product
  const products = await stripe.products.list({ limit: 100, active: true })
  const existing = products.data.find((p) => p.name === PRODUCT_NAME)
  if (existing) {
    product = existing
    console.log(`✓ Producto existente: ${product.id}`)
  } else {
    product = await stripe.products.create({
      name:        PRODUCT_NAME,
      description: "Acceso completo a DGT Tests · todos los tests, IA, competición sin restricciones",
    })
    console.log(`✓ Producto creado: ${product.id}`)
  }

  // 2. Buscar/crear el price
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 })
  const matching = prices.data.find(
    (p) =>
      p.unit_amount === TARGET_AMOUNT &&
      p.currency === TARGET_CURRENCY &&
      p.recurring?.interval === TARGET_INTERVAL
  )

  let price: Stripe.Price
  if (matching) {
    price = matching
    console.log(`✓ Price existente: ${price.id} · ${(price.unit_amount! / 100).toFixed(2)} ${price.currency.toUpperCase()}/${price.recurring?.interval}`)
  } else {
    price = await stripe.prices.create({
      product:    product.id,
      unit_amount: TARGET_AMOUNT,
      currency:   TARGET_CURRENCY,
      recurring:  { interval: TARGET_INTERVAL },
    })
    console.log(`✓ Price creado:   ${price.id} · 5,00 EUR / mes`)
  }

  console.log()
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  console.log("Pega esto en tu .env.local:")
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  console.log(`STRIPE_PRICE_ID="${price.id}"`)
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
}

main().catch((e) => { console.error("❌", e); process.exit(1) })
