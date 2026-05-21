/**
 * Quota mensual de tokens IA por usuario.
 *
 * Cada usuario tiene `aiTokensUsed` (cuántos ha gastado) y `aiTokensMonth`
 * (mes correspondiente a ese contador, formato "YYYY-MM"). Al cambiar de
 * mes natural el contador se resetea automáticamente.
 */

import { db } from "@/lib/db"

export const MAX_AI_TOKENS_PER_MONTH = Number(
  process.env.AI_TOKENS_PER_MONTH ?? 50
)

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
    select: { aiTokensUsed: true, aiTokensMonth: true },
  })
  if (!user) {
    return {
      used: 0,
      max: MAX_AI_TOKENS_PER_MONTH,
      remaining: MAX_AI_TOKENS_PER_MONTH,
      month: monthKey,
      resetsAt: nextMonthResetIso(),
    }
  }
  // Si el mes guardado no coincide, lo reseteamos en disco
  if (user.aiTokensMonth !== monthKey) {
    await db.user.update({
      where: { id: userId },
      data: { aiTokensUsed: 0, aiTokensMonth: monthKey },
    })
    return {
      used: 0,
      max: MAX_AI_TOKENS_PER_MONTH,
      remaining: MAX_AI_TOKENS_PER_MONTH,
      month: monthKey,
      resetsAt: nextMonthResetIso(),
    }
  }
  return {
    used:      user.aiTokensUsed,
    max:       MAX_AI_TOKENS_PER_MONTH,
    remaining: Math.max(0, MAX_AI_TOKENS_PER_MONTH - user.aiTokensUsed),
    month:     monthKey,
    resetsAt:  nextMonthResetIso(),
  }
}

/**
 * Intenta consumir 1 token. Devuelve `null` si el usuario ya agotó su quota
 * mensual, o el nuevo estado si pudo consumir.
 */
export async function consumeToken(userId: number): Promise<AIQuotaStatus | null> {
  const current = await getQuotaStatus(userId)
  if (current.remaining <= 0) return null

  const updated = await db.user.update({
    where: { id: userId },
    data:  { aiTokensUsed: { increment: 1 } },
    select: { aiTokensUsed: true, aiTokensMonth: true },
  })
  return {
    used:      updated.aiTokensUsed,
    max:       MAX_AI_TOKENS_PER_MONTH,
    remaining: Math.max(0, MAX_AI_TOKENS_PER_MONTH - updated.aiTokensUsed),
    month:     updated.aiTokensMonth,
    resetsAt:  nextMonthResetIso(),
  }
}
