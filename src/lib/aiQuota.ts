/**
 * Quota mensual de tokens IA por usuario.
 *
 * Modelo de renovación (anniversary-based, no calendar-month):
 *
 *   1. FREE que NUNCA fue PRO → renueva en el aniversario mensual de
 *      `createdAt`. Si el user se registró el día 15, renueva cada día 15.
 *
 *   2. PRO activo → renueva el día de billing de Stripe (sincronizado con
 *      `subscriptionCurrentPeriodEnd`). Webhook `customer.subscription.updated`
 *      mantiene el campo actualizado.
 *
 *   3. Ex-PRO (sub caducada) → renueva en el aniversario mensual de la
 *      fecha de expiry. Webhook `customer.subscription.deleted` setea la
 *      primera fecha (expiry + 1 mes).
 *
 * Persiste en `User.aiTokensRenewalAt`. Avanza lazy aquí cuando se accede
 * y la fecha ya pasó (puede haber pasado mucho tiempo sin uso → bucle
 * hasta encontrar la siguiente fecha futura).
 *
 * El máximo depende del plan: 10 para usuarios FREE, 50/60 para SUBSCRIBER
 * y ADMIN. Ver src/lib/permissions.ts.
 */

import { db } from "@/lib/db"
import { getEffectiveTokenQuota } from "@/lib/permissions"
import { getAITokensFree, getAITokensPro } from "@/lib/configCatalog"
import { addOneMonthUtc, advanceUntilFuture, computeInitialRenewal } from "@/lib/tokenRenewal"

export interface AIQuotaStatus {
  used:        number
  max:         number
  remaining:   number
  /** Fecha ISO en la que se reseteará el contador. */
  resetsAt:    string
}

/**
 * Devuelve el estado actual de la quota. Si la fecha de renovación ya pasó,
 * resetea el contador y avanza la fecha al próximo aniversario futuro
 * (todo en una sola UPDATE atómica).
 *
 * Lazy backfill: usuarios pre-existentes con `aiTokensRenewalAt = null`
 * reciben su fecha calculada al primer acceso, sin necesidad de un job
 * batch.
 */
export async function getQuotaStatus(userId: number): Promise<AIQuotaStatus> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      aiTokensUsed:                 true,
      aiTokensRenewalAt:            true,
      role:                         true,
      subscriptionStatus:           true,
      subscriptionCurrentPeriodEnd: true,
      createdAt:                    true,
    },
  })
  const max = await getEffectiveQuotaForUser(user)
  if (!user) {
    return { used: 0, max, remaining: max, resetsAt: addOneMonthUtc(new Date()).toISOString() }
  }

  const now = new Date()
  const renewalAt: Date = user.aiTokensRenewalAt ?? computeInitialRenewal(user, now)

  // Si ya pasó → reset + avanzar
  if (now >= renewalAt) {
    const next = advanceUntilFuture(renewalAt, now)
    await db.user.update({
      where: { id: userId },
      data:  { aiTokensUsed: 0, aiTokensRenewalAt: next },
    })
    return { used: 0, max, remaining: max, resetsAt: next.toISOString() }
  }

  // Backfill silencioso si nunca se calculó
  if (!user.aiTokensRenewalAt) {
    await db.user.update({
      where: { id: userId },
      data:  { aiTokensRenewalAt: renewalAt },
    })
  }

  return {
    used:      user.aiTokensUsed,
    max,
    remaining: Math.max(0, max - user.aiTokensUsed),
    resetsAt:  renewalAt.toISOString(),
  }
}

/**
 * Intenta consumir 1 token. Devuelve `null` si el usuario ya agotó su quota
 * mensual, o el nuevo estado si pudo consumir.
 */
export async function consumeToken(userId: number): Promise<AIQuotaStatus | null> {
  return consumeTokens(userId, 1)
}

/**
 * Intenta consumir N tokens (atómicamente, all-or-nothing).
 * Devuelve `null` si al usuario no le quedan N disponibles. Si sí, los
 * incrementa en una sola query y devuelve el estado actualizado.
 *
 * Usado por features que cobran > 1 token (p.ej. análisis IA del dashboard,
 * 5 tokens). El refund manual (decrement) lo hace el endpoint si el
 * provider falla.
 */
export async function consumeTokens(userId: number, n: number): Promise<AIQuotaStatus | null> {
  if (n <= 0) throw new Error("consumeTokens: n debe ser > 0")
  const current = await getQuotaStatus(userId)
  if (current.remaining < n) return null

  const updated = await db.user.update({
    where: { id: userId },
    data:  { aiTokensUsed: { increment: n } },
    select: {
      aiTokensUsed:        true,
      aiTokensRenewalAt:   true,
      role:                true,
      subscriptionStatus:  true,
    },
  })
  const max = await getEffectiveQuotaForUser(updated)
  return {
    used:      updated.aiTokensUsed,
    max,
    remaining: Math.max(0, max - updated.aiTokensUsed),
    resetsAt:  (updated.aiTokensRenewalAt ?? new Date()).toISOString(),
  }
}

/**
 * Como permissions.getEffectiveTokenQuota pero leyendo los límites de
 * AppConfig (panel admin Fase 92). Si la BBDD no tiene override, cae al
 * default del catálogo (que coincide con la constante histórica).
 */
async function getEffectiveQuotaForUser(
  user: { role: string | null; subscriptionStatus: string | null } | null
): Promise<number> {
  const isFullAccess = Boolean(
    user && (user.role === "ADMIN" ||
      (user.role === "SUBSCRIBER" &&
        (user.subscriptionStatus === "active" ||
         user.subscriptionStatus === "trialing" ||
         user.subscriptionStatus === "past_due")))
  )
  return isFullAccess ? await getAITokensPro() : await getAITokensFree()
}
// Mantenemos el import para que el linter no se queje de unused.
// Los callers síncronos (UI que no quiere awaits) pueden seguir usándolo.
void getEffectiveTokenQuota
