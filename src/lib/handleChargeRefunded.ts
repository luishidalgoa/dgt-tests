/**
 * Lógica del handler de webhook `charge.refunded`.
 *
 * Separada del route handler para que sea testeable con mocks de Prisma
 * y Stripe en vez de hits reales. El route.ts es solo un wrapper que
 * pasa el cliente real.
 *
 * ⚠ POLÍTICA de negocio (ver return-policy en la app):
 *   El servicio NO ofrece reembolso voluntario de suscripción. La única
 *   razón legítima para que llegue un charge.refunded es un COBRO ERRÓNEO
 *   tramitado por el administrador desde el Stripe Dashboard.
 *   Por tanto:
 *     - Refund TOTAL → el cobro no debería haber existido → revocamos
 *       acceso al instante (cancel sub immediate + role=USER).
 *     - Refund PARCIAL → ajuste / prorrateo. No anulación. Solo log.
 *     - User es ADMIN → intocable (los admins no se ven afectados por
 *       cambios de billing).
 *
 * Si en el futuro se ofrecen reembolsos sin perder acceso (caso raro),
 * habría que añadir lógica adicional aquí — pero por defecto: refund
 * total = revocación.
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
