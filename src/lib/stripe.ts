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
import { getEffectiveSecret } from "@/lib/secretCatalog"

/**
 * Cliente Stripe. Lee la STRIPE_SECRET_KEY del helper (BBDD admin
 * override → fallback .env). Async porque AppConfig se consulta en
 * BBDD; no cacheamos el cliente entre llamadas para que un cambio
 * desde /admin/secrets aplique al instante.
 */
export async function getStripe(): Promise<Stripe> {
  const key = await getEffectiveSecret("STRIPE_SECRET_KEY")
  if (!key) throw new Error("No hay STRIPE_SECRET_KEY configurada (ni .env ni /admin/secrets)")
  return new Stripe(key, { typescript: true })
}

/** Igual: lee desde el helper. Async. */
export async function getStripeWebhookSecret(): Promise<string> {
  const v = await getEffectiveSecret("STRIPE_WEBHOOK_SECRET")
  if (!v) throw new Error("No hay STRIPE_WEBHOOK_SECRET configurada")
  return v
}

// STRIPE_PRICE_ID NO es secret (es público y configurable, no sensible).
// Se queda como env var directo, sin pasar por el helper de cifrado.
export const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID ?? ""

// Compat: re-export síncrono del webhook secret. SOLO úsalo en código
// legacy; lo nuevo debería usar getStripeWebhookSecret().
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

/**
 * ¿Está la suscripción marcada para NO renovarse?
 *
 * Stripe expresa "no auto-renovación" de DOS formas:
 *   - `cancel_at_period_end: true` → boolean. Cancela al final del current
 *     period actual. Lo setea el flow del portal cuando eliges "Cancel at
 *     the end of the billing period".
 *   - `cancel_at: <timestamp>` → fecha específica. Lo setea el portal
 *     cuando eliges "Cancel on a specific date" (a veces es el mismo flow
 *     "end of period" porque Stripe convierte a fecha fija). El boolean
 *     queda en false aunque haya un cancel_at en el futuro.
 *
 * Para la UI nos da igual cómo Stripe lo exprese: si CUALQUIERA de los
 * dos indica cancelación pendiente, la renovación automática NO va a
 * ocurrir.
 */
export function willNotAutoRenew(sub: Stripe.Subscription): boolean {
  if (sub.cancel_at_period_end) return true
  if (typeof sub.cancel_at === "number" && sub.cancel_at > 0) return true
  return false
}

/**
 * Fecha efectiva en la que la suscripción acabará.
 *   - Si hay `cancel_at` → ese timestamp (tiene prioridad porque puede
 *     ser distinto del fin del periodo actual).
 *   - Si no → el fin del periodo actual (items[0].current_period_end).
 */
export function getSubscriptionEndDate(sub: Stripe.Subscription): number | null {
  if (typeof sub.cancel_at === "number" && sub.cancel_at > 0) return sub.cancel_at
  return getSubscriptionPeriodEnd(sub)
}
