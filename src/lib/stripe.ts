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

/**
 * Extrae el `current_period_end` (en segundos epoch) de una Subscription.
 *
 * Importante: a partir de la API '2024-09-30.acacia' Stripe movió
 * `current_period_end` del top-level de Subscription a los items
 * (`items.data[i].current_period_end`), porque una sub puede tener items
 * con periodos distintos. Para nuestro caso (1 sub = 1 item), el valor es
 * idéntico al campo viejo cuando existe.
 *
 * Esta función prueba primero la ubicación nueva y cae al campo viejo
 * para versiones de API más antiguas. Devuelve `null` si no encuentra
 * ninguno.
 */
export function getSubscriptionPeriodEnd(sub: Stripe.Subscription): number | null {
  const fromItem = sub.items?.data?.[0]?.current_period_end
  if (typeof fromItem === "number") return fromItem

  const topLevel = (sub as Stripe.Subscription & { current_period_end?: number }).current_period_end
  if (typeof topLevel === "number") return topLevel

  return null
}
