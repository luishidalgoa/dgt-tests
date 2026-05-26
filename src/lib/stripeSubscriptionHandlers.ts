/**
 * Lógica de actualización de la BBDD al recibir eventos de suscripción de
 * Stripe. Vive separada de `app/api/webhooks/stripe/route.ts` para poder
 * testearse en aislamiento — el route.ts solo orquesta + valida firma.
 *
 * Tres operaciones que cubren los eventos relevantes para el sistema de
 * renovación de tokens IA:
 *
 *   - applySubscriptionUpdate    → customer.subscription.created + updated
 *   - applySubscriptionDeleted   → customer.subscription.deleted (expiry)
 *
 * Ambos llaman a `db.user.update` con los campos correspondientes —
 * incluyendo `aiTokensRenewalAt` calculado vía las funciones puras de
 * `tokenRenewal.ts`.
 */

import {
  computeRenewalAfterSubUpdate,
  computeRenewalAfterSubExpiry,
} from "@/lib/tokenRenewal"

// ── Tipos ───────────────────────────────────────────────────────────────

interface UserStateBeforeUpdate {
  role:                          "USER" | "SUBSCRIBER" | "ADMIN" | string | null
  subscriptionCancelAtPeriodEnd: boolean | null
  subscriptionCurrentPeriodEnd:  Date | null
}

interface SubscriptionUpdateArgs {
  userId:             number
  stripeCustomerId:   string
  subscriptionId:     string
  status:             string                 // active, past_due, trialing, canceled, ...
  priceId:            string | null
  newPeriodEnd:       Date | null            // viene del helper getSubscriptionEndDate
  cancelAtPeriodEnd:  boolean
}

interface SubscriptionDeletedArgs {
  userId:             number
  endedAt:            Date | null
}

interface DbDeps {
  user: {
    findUnique: (args: { where: { id: number }; select: Record<string, true> }) => Promise<UserStateBeforeUpdate | null>
    update:     (args: { where: { id: number }; data: Record<string, unknown> }) => Promise<unknown>
  }
}

// ── Handlers ────────────────────────────────────────────────────────────

/**
 * Aplica un cambio de suscripción (created/updated) en BBDD.
 *
 * Reglas de tokens IA:
 *   - aiTokensRenewalAt ← newPeriodEnd (si existe)
 *   - aiTokensUsed = 0 si fue una renovación REAL (period_end avanzó)
 *
 * Reglas de rol:
 *   - Si user es ADMIN, role no se toca
 *   - Si sub está activa o trialing → SUBSCRIBER
 *   - Si no → USER
 */
export async function applySubscriptionUpdate(
  args: SubscriptionUpdateArgs,
  db:   DbDeps,
): Promise<{ isRenewal: boolean }> {
  const current = await db.user.findUnique({
    where:  { id: args.userId },
    select: {
      role:                          true,
      subscriptionCancelAtPeriodEnd: true,
      subscriptionCurrentPeriodEnd:  true,
    },
  })

  const isAdmin   = current?.role === "ADMIN"
  const isActive  = args.status === "active" || args.status === "trialing"
  const oldPeriodEnd = current?.subscriptionCurrentPeriodEnd ?? null
  const renewal = computeRenewalAfterSubUpdate(args.newPeriodEnd, oldPeriodEnd)

  await db.user.update({
    where: { id: args.userId },
    data: {
      stripeCustomerId:              args.stripeCustomerId,
      stripeSubscriptionId:          args.subscriptionId,
      subscriptionStatus:            args.status,
      subscriptionPriceId:           args.priceId,
      subscriptionCurrentPeriodEnd:  args.newPeriodEnd,
      subscriptionCancelAtPeriodEnd: args.cancelAtPeriodEnd,
      ...(isAdmin ? {} : { role: isActive ? "SUBSCRIBER" : "USER" }),
      ...(renewal.aiTokensRenewalAt ? { aiTokensRenewalAt: renewal.aiTokensRenewalAt } : {}),
      ...(renewal.shouldResetTokens ? { aiTokensUsed: 0 } : {}),
    },
  })

  return { isRenewal: renewal.shouldResetTokens }
}

/**
 * Aplica la caducidad de una suscripción (`customer.subscription.deleted`).
 *
 * Reglas:
 *   - Usuario vuelve a rol USER (salvo ADMIN, intocable)
 *   - Status → "canceled"
 *   - aiTokensRenewalAt ← endedAt + 1 mes (próximo aniversario)
 *   - aiTokensUsed = 0 (reset al pasar a FREE — quota fresca)
 */
export async function applySubscriptionDeleted(
  args: SubscriptionDeletedArgs,
  db:   DbDeps,
): Promise<void> {
  const current = await db.user.findUnique({
    where:  { id: args.userId },
    select: {
      role:                          true,
      subscriptionCancelAtPeriodEnd: true,
      subscriptionCurrentPeriodEnd:  true,
    },
  })
  const isAdmin = current?.role === "ADMIN"

  const expiry = computeRenewalAfterSubExpiry(args.endedAt)

  await db.user.update({
    where: { id: args.userId },
    data: {
      subscriptionStatus:            "canceled",
      subscriptionCurrentPeriodEnd:  args.endedAt,
      subscriptionCancelAtPeriodEnd: false,
      stripeSubscriptionId:          null,
      ...(isAdmin ? {} : { role: "USER" }),
      ...(expiry.aiTokensRenewalAt ? { aiTokensRenewalAt: expiry.aiTokensRenewalAt } : {}),
      ...(expiry.shouldResetTokens ? { aiTokensUsed: 0 } : {}),
    },
  })
}
