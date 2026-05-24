/**
 * Tests del helper que dispara la animación de XP gain.
 *
 * Lo importante que vigilan estos tests (contrato entre el flow del
 * endpoint y la animación `<XpGainBubble>`):
 *
 *   1. Cuando el examen real da base + bonus diario, se hace UNA SOLA
 *      escritura en storage con el TOTAL combinado. La animación NO se
 *      ejecuta dos veces.
 *   2. Si en el futuro alguien intentara separar la animación en dos
 *      eventos (base y bonus por separado), este test lo cazaría.
 *   3. Si no hay XP que mostrar (errores mode, sin bonus, etc.), no
 *      se escribe nada — no aparece bubble fantasma.
 */

import { describe, it, expect, vi } from "vitest"
import { triggerXpGainAnimation, XP_GAIN_STORAGE_KEY } from "./xpAnimation"
import type { AttemptXpReward } from "@/types/exam"

/** Storage mock minimalista — solo lo que necesita el helper. Permite
 *  spy en setItem para contar llamadas. */
class StorageMock {
  items = new Map<string, string>()
  setItem = vi.fn((key: string, value: string) => {
    this.items.set(key, value)
  })
  getItem(key: string) {
    return this.items.get(key) ?? null
  }
}

/** Construye un `AttemptXpReward` con overrides. */
function mkReward(overrides: Partial<AttemptXpReward> = {}): AttemptXpReward {
  return {
    awarded:     0,
    breakdown:   [],
    leveledUp:   false,
    newLevel:    0,
    oldLevel:    0,
    iconPath:    "/streak/lvl-0.png",
    levelLabel:  "Llama apagada",
    prevXp:      0,
    newXp:       0,
    nextLevelXp: 50,
    progressPct: 0,
    ...overrides,
  }
}

describe("triggerXpGainAnimation — animación es agnóstica a la fuente", () => {
  it("examen real con base + bonus → UN solo setItem con el total combinado", () => {
    // Caso reportado por el usuario: hace un examen real con 1 error
    // (base 14) y es D1 (bonus 5). El endpoint construye el payload con
    // awarded=19 y breakdown de 2 items. El helper debe persistir UNA
    // sola vez — la animación bubble lee el awarded combinado.
    const storage = new StorageMock()
    const reward = mkReward({
      awarded: 19,
      breakdown: [
        { reason: "exam-finish", amount: 14 },
        { reason: "streak-day",  amount: 5 },
      ],
      prevXp: 5,
      newXp:  24,
      progressPct: 48,
    })

    const fired = triggerXpGainAnimation(reward, storage)

    expect(fired).toBe(true)
    // Clave: UNA SOLA llamada a setItem. Si en el futuro alguien
    // separa "base" y "bonus" en dos eventos, esto pasaría a 2 y
    // este assertion los cazaría.
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(storage.setItem).toHaveBeenCalledWith(
      XP_GAIN_STORAGE_KEY,
      expect.any(String),
    )
    // El value persistido tiene el TOTAL combinado, no solo la base.
    const persisted = JSON.parse(storage.items.get(XP_GAIN_STORAGE_KEY)!) as AttemptXpReward
    expect(persisted.awarded).toBe(19)
    expect(persisted.breakdown).toHaveLength(2)
    expect(persisted.breakdown.map((b) => b.reason)).toEqual([
      "exam-finish",
      "streak-day",
    ])
  })

  it("examen real solo con base (bonus ya cobrado hoy) → setItem ÚNICO con awarded=base", () => {
    // Si el bonus diario ya se pagó hoy, el endpoint devuelve solo la
    // base en awarded. La animación se dispara igualmente con ese valor.
    const storage = new StorageMock()
    const reward = mkReward({
      awarded: 14,
      breakdown: [{ reason: "exam-finish", amount: 14 }],
      prevXp: 10,
      newXp: 24,
      progressPct: 48,
    })

    const fired = triggerXpGainAnimation(reward, storage)

    expect(fired).toBe(true)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    const persisted = JSON.parse(storage.items.get(XP_GAIN_STORAGE_KEY)!) as AttemptXpReward
    expect(persisted.awarded).toBe(14)
  })

  it("examen tema/práctica con solo bonus diario → setItem ÚNICO con awarded=bonus", () => {
    // Tema o normal-sin-cronómetro no dan base, pero sí bonus diario.
    // La animación debe dispararse igual, con awarded=bonus.
    const storage = new StorageMock()
    const reward = mkReward({
      awarded: 5,
      breakdown: [{ reason: "streak-day", amount: 5 }],
      prevXp: 0,
      newXp: 5,
      progressPct: 10,
    })

    const fired = triggerXpGainAnimation(reward, storage)

    expect(fired).toBe(true)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    const persisted = JSON.parse(storage.items.get(XP_GAIN_STORAGE_KEY)!) as AttemptXpReward
    expect(persisted.awarded).toBe(5)
    expect(persisted.breakdown[0].reason).toBe("streak-day")
  })

  it("awarded = 0 → NO setItem (no bubble fantasma)", () => {
    // Modo errores o bonus ya cobrado en práctica → awarded=0.
    // No queremos disparar la animación con 0 XP.
    const storage = new StorageMock()
    const fired = triggerXpGainAnimation(mkReward({ awarded: 0 }), storage)
    expect(fired).toBe(false)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it("reward null / undefined → NO setItem (defensa contra response malformada)", () => {
    const storage = new StorageMock()
    expect(triggerXpGainAnimation(null, storage)).toBe(false)
    expect(triggerXpGainAnimation(undefined, storage)).toBe(false)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it("storage no disponible (SSR / modo incógnito raro) → false sin lanzar", () => {
    const fired = triggerXpGainAnimation(
      mkReward({ awarded: 10 }),
      undefined,
    )
    expect(fired).toBe(false)
  })

  it("dos llamadas consecutivas → segunda sobreescribe la primera (idempotencia)", () => {
    // Defensa contra un bug hipotético donde el caller invocara dos
    // veces. setItem es idempotente: el último value gana, no se
    // concatenan ni se duplica el reward. La animación se dispara
    // una sola vez al pintar la bubble.
    const storage = new StorageMock()
    triggerXpGainAnimation(mkReward({ awarded: 14 }), storage)
    triggerXpGainAnimation(mkReward({ awarded: 19 }), storage)

    expect(storage.setItem).toHaveBeenCalledTimes(2) // sí se llama 2 veces
    // ...pero el storage solo tiene el último value:
    const persisted = JSON.parse(storage.items.get(XP_GAIN_STORAGE_KEY)!) as AttemptXpReward
    expect(persisted.awarded).toBe(19)
  })

  it("setItem que lanza (storage lleno) → false, sin propagar el error", () => {
    // sessionStorage puede tirar QuotaExceededError si está lleno.
    // El helper debe atrapar y devolver false para que el caller
    // pueda hacer fallback al toast.
    const storage = new StorageMock()
    storage.setItem = vi.fn(() => {
      throw new Error("QuotaExceededError")
    })
    const fired = triggerXpGainAnimation(mkReward({ awarded: 10 }), storage)
    expect(fired).toBe(false)
  })
})
