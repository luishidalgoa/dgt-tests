/**
 * Lógica del handler de webhook `charge.refunded`.
 *
 * Separada del route handler para que sea testeable con mocks de Prisma
 * y Stripe en vez de hits reales. El route.ts es solo un wrapper que
 * pasa el cliente real.
 *
 * Política Fase 88:
 *   - Refund TOTAL (amount_refunded === amount): revocar acceso. Cancelamos
 *     la sub en Stripe (immediate) y bajamos role a USER. El user pierde
 *     PRO al instante.
 *   - Refund PARCIAL: solo log. No es una anulación, es un ajuste.
 *   - User no es SUBSCRIBER (USER o ADMIN): no se toca el role. ADMIN
 *     nunca pierde acceso por un refund.
 */

import type Stripe from "stripe"

/** Mínimo del cliente Prisma que necesitamos. */
export interface RefundDb {
  user: {
    findFirst: (args: {
      where: { stripeCustomerId: string }
    }) => Promise<{
      id:                   number
      username:             string
      role:                 "USER" | "SUBSCRIBER" | "ADMIN"
      stripeCustomerId:     string | null
      stripeSubscriptionId: string | null
    } | null>
    update: (args: {
      where: { id: number }
      data:  Record<string, unknown>
    }) => Promise<unknown>
  }
}

/** Mínimo del cliente Stripe que necesitamos. */
export interface RefundStripe {
  subscriptions: {
    cancel: (id: string) => Promise<Stripe.Subscription>
  }
}

export async function handleChargeRefunded(
  charge: Stripe.Charge,
  deps: { db: RefundDb; stripe: RefundStripe }
): Promise<void> {
  const customerId = typeof charge.customer === "string"
    ? charge.customer
    : charge.customer?.id ?? null
  const isTotal = charge.amount_refunded >= charge.amount

  console.log("[stripe webhook] charge.refunded", {
    chargeId:        charge.id,
    customerId,
    amount:          charge.amount,
    amountRefunded:  charge.amount_refunded,
    isTotalRefund:   isTotal,
  })

  if (!isTotal) return
  if (!customerId) return

  const user = await deps.db.user.findFirst({
    where: { stripeCustomerId: customerId },
  })
  if (!user) {
    console.warn(`[stripe webhook] charge.refunded: customer '${customerId}' sin user en BBDD`)
    return
  }

  if (user.role === "ADMIN") {
    console.warn(`[stripe webhook] charge.refunded: user '${user.username}' es ADMIN, no se revoca`)
    return
  }

  if (user.stripeSubscriptionId) {
    try {
      await deps.stripe.subscriptions.cancel(user.stripeSubscriptionId)
    } catch (err) {
      console.warn(
        `[stripe webhook] charge.refunded: stripe.subscriptions.cancel falló para '${user.stripeSubscriptionId}': ${err instanceof Error ? err.message : err}`
      )
    }
  }

  await deps.db.user.update({
    where: { id: user.id },
    data: {
      role:                          "USER",
      subscriptionStatus:            "canceled",
      stripeSubscriptionId:          null,
      subscriptionCancelAtPeriodEnd: false,
    },
  })
  console.log(`[stripe webhook] charge.refunded: user '${user.username}' degradado a USER por refund total`)
}
