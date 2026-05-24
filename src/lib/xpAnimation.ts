/**
 * Helper único para disparar la animación de XP gain tras un examen.
 *
 * El backend ya devuelve `AttemptXpReward.awarded` con la SUMA combinada
 * de base + bonus diario. Esta función simplemente persiste el payload
 * en sessionStorage para que `<XpGainBubble>` (montado en el layout)
 * lo lea tras el redirect y dispare la animación.
 *
 * Diseñada como función pura testeable:
 *   - Recibe el storage como parámetro inyectable (default
 *     `window.sessionStorage` en cliente, `undefined` en SSR).
 *   - Devuelve un boolean para que el caller pueda decidir si caer a
 *     un fallback (p.ej. toast simple) si setItem falla o no hay
 *     storage disponible.
 *   - GARANTIZA que solo hace UN setItem por llamada — eso es lo que
 *     vigilan los tests, para que en el futuro nadie pueda separar
 *     "animación de base" y "animación de bonus" en dos eventos.
 */

import type { AttemptXpReward } from "@/types/exam"

/** Clave en sessionStorage donde se persiste el reward hasta que la
 *  bubble lo consume. */
export const XP_GAIN_STORAGE_KEY = "dgt:xp-gain"

/**
 * Persiste el reward para disparar la animación bubble tras el redirect.
 *
 * @returns true si el setItem se hizo (o sea, la animación se va a
 *   disparar en el siguiente cambio de ruta). false si no había nada
 *   que mostrar (awarded ≤ 0) o si el storage no estaba disponible.
 */
export function triggerXpGainAnimation(
  reward: AttemptXpReward | undefined | null,
  storage: Pick<Storage, "setItem"> | undefined =
    typeof window !== "undefined" ? window.sessionStorage : undefined,
): boolean {
  if (!reward) return false
  if (reward.awarded <= 0) return false
  if (!storage) return false
  try {
    storage.setItem(XP_GAIN_STORAGE_KEY, JSON.stringify(reward))
    return true
  } catch {
    return false
  }
}
