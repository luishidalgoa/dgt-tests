"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { ATTEMPT_STATS_WHERE } from "@/lib/stats"
import {
  computeStreakState,
  yesterdayMidnight,
} from "@/lib/streak"

/**
 * Server Action: gasta 1 crédito para restaurar la racha rota ayer.
 *
 * Guardrails (re-validamos TODO en servidor — el botón en cliente puede
 * mentir / quedar stale frente a un cambio reciente en otra pestaña):
 *
 *   1. Usuario autenticado.
 *   2. El user tiene >=1 crédito.
 *   3. El estado calculado AHORA dice `canRestore=true`:
 *      - ayer no tiene examen real ni está ya restaurado
 *      - anteayer SÍ tiene examen real
 *      - streakRestoredUntil no es ya el día de ayer
 *
 * Side-effects (en una transacción):
 *   - decrementa `streakRestoreCredits` (-1).
 *   - escribe `streakRestoredUntil = ayer (medianoche local del server)`.
 *
 * Revalida `/` para que el dashboard re-renderice con la racha "viva"
 * sin necesidad de un router.refresh() explícito.
 */
export async function restoreStreakAction(): Promise<
  | { ok: true; remainingCredits: number }
  | { ok: false; error: string }
> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: "No autenticado" }

  if (user.streakRestoreCredits <= 0) {
    return { ok: false, error: "No te quedan créditos de restauración" }
  }

  // Re-calcular el estado de racha en el servidor para validar
  // eligibilidad antes de gastar el crédito.
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000)
  const recent = await db.examAttempt.findMany({
    where: {
      userId:     user.id,
      finishedAt: { not: null },
      startedAt:  { gte: sevenDaysAgo },
      ...ATTEMPT_STATS_WHERE,
    },
    select: { startedAt: true },
  })
  const state = computeStreakState(
    recent.map(a => a.startedAt),
    user.streakRestoredUntil,
    now,
    { credits: user.streakRestoreCredits }
  )

  if (!state.canRestore) {
    return { ok: false, error: "La racha no se puede restaurar ahora mismo" }
  }

  const yesterday = yesterdayMidnight(now)

  // Transacción defensiva contra clicks dobles: condicionamos el UPDATE
  // a "todavía tiene >=1 crédito y restoredUntil no es ya ayer". Si dos
  // peticiones llegan a la vez, solo una toma efecto.
  const updated = await db.user.updateMany({
    where: {
      id: user.id,
      streakRestoreCredits: { gte: 1 },
      OR: [
        { streakRestoredUntil: null },
        { streakRestoredUntil: { not: yesterday } },
      ],
    },
    data: {
      streakRestoreCredits: { decrement: 1 },
      streakRestoredUntil:  yesterday,
    },
  })

  if (updated.count === 0) {
    return { ok: false, error: "La racha ya estaba restaurada" }
  }

  revalidatePath("/")
  return {
    ok: true,
    remainingCredits: user.streakRestoreCredits - 1,
  }
}
