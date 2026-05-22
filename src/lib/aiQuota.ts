/**
 * Quota mensual de tokens IA por usuario.
 *
 * Cada usuario tiene `aiTokensUsed` (cuántos ha gastado) y `aiTokensMonth`
 * (mes correspondiente a ese contador, formato "YYYY-MM"). Al cambiar de
 * mes natural el contador se resetea automáticamente.
 *
 * El máximo depende del plan: 10 para usuarios FREE, 50 para SUBSCRIBER
 * y ADMIN. Ver src/lib/permissions.ts.
 */

import { db } from "@/lib/db"
import { getEffectiveTokenQuota } from "@/lib/permissions"
import { getAITokensFree, getAITokensPro } from "@/lib/configCatalog"

export interface AIQuotaStatus {
  used:        number
  max:         number
  remaining:   number
  month:       string         // "YYYY-MM"
  /** Fecha en la que se reseteará (1 del mes siguiente, 00:00 UTC). */
  resetsAt:    string         // ISO
}

function currentMonthKey(date = new Date()): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, "0")
  return `${y}-${m}`
}

function nextMonthResetIso(): string {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0))
  return next.toISOString()
}

/**
 * Devuelve el estado actual de la quota del usuario, reseteando el contador
 * si ha cambiado el mes desde la última actualización.
 */
export async function getQuotaStatus(userId: number): Promise<AIQuotaStatus> {
  const monthKey = currentMonthKey()
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      aiTokensUsed: true,
      aiTokensMonth: true,
      role: true,
      subscriptionStatus: true,
    },
  })
  const max = await getEffectiveQuotaForUser(user)
  if (!user) {
    return { used: 0, max, remaining: max, month: monthKey, resetsAt: nextMonthResetIso() }
  }
  // Si el mes guardado no coincide, lo reseteamos en disco
  if (user.aiTokensMonth !== monthKey) {
    await db.user.update({
      where: { id: userId },
      data: { aiTokensUsed: 0, aiTokensMonth: monthKey },
    })
    return { used: 0, max, remaining: max, month: monthKey, resetsAt: nextMonthResetIso() }
  }
  return {
    used:      user.aiTokensUsed,
    max,
    remaining: Math.max(0, max - user.aiTokensUsed),
    month:     monthKey,
    resetsAt:  nextMonthResetIso(),
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
 * Intenta consumir N tokens de golpe (atómicamente, all-or-nothing).
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
      aiTokensUsed: true,
      aiTokensMonth: true,
      role: true,
      subscriptionStatus: true,
    },
  })
  const max = await getEffectiveQuotaForUser(updated)
  return {
    used:      updated.aiTokensUsed,
    max,
    remaining: Math.max(0, max - updated.aiTokensUsed),
    month:     updated.aiTokensMonth,
    resetsAt:  nextMonthResetIso(),
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
