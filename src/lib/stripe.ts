/**
 * Cliente Stripe singleton.
 *
 * Env vars necesarias (todas en .env / Vercel):
 *   STRIPE_SECRET_KEY              · sk_test_... | sk_live_...
 *   STRIPE_WEBHOOK_SECRET          · whsec_...
 *   STRIPE_PRICE_ID                · price_... (recurrente 6,99€/mes)
 *   NEXT_PUBLIC_APP_URL            · https://... (usado para success_url y cancel_url)
 *
 * `STRIPE_PRICE_ID` debe apuntar a un Price (no Product) recurrente mensual
 * de 6,99€ en EUR. Lo creas desde https://dashboard.stripe.com/test/products
 * → "Add product" → recurring monthly → 6,99 EUR.
 */

import Stripe from "stripe"

function getEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Falta ${name} en .env`)
  return v
}

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(getEnv("STRIPE_SECRET_KEY"), {
      // Dejamos la última API version por defecto del SDK.
      typescript: true,
    })
  }
  return _stripe
}

export const STRIPE_PRICE_ID    = process.env.STRIPE_PRICE_ID ?? ""
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? ""

export function appUrl(path: string = "/"): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:4321"
  return new URL(path, base).toString()
}
