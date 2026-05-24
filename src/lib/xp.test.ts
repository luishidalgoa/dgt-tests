/**
 * Tests puros sobre los helpers de XP. NO toca BBDD — `awardXp` y
 * `awardWeeklyStreakBonusIfDue` son integraciones y se cubrirán aparte.
 */

import { describe, it, expect } from "vitest"
import { LEVELS, MAX_LEVEL, getLevel, computeExamXp, sumXp } from "./xp"

describe("getLevel", () => {
  it("XP = 0 → nivel 0 con barra al 0%", () => {
    const info = getLevel(0)
    expect(info.level).toBe(0)
    expect(info.iconPath).toBe("/streak/lvl-0.png")
    expect(info.minXp).toBe(0)
    expect(info.nextLevelXp).toBe(50)
    expect(info.xpToNext).toBe(50)
    expect(info.progressPct).toBe(0)
  })

  it("XP justo en el umbral del nivel siguiente sube de nivel", () => {
    // 50 XP exactos = lvl 1
    const info = getLevel(50)
    expect(info.level).toBe(1)
    expect(info.iconPath).toBe("/streak/lvl-1.png")
    expect(info.minXp).toBe(50)
    expect(info.nextLevelXp).toBe(150)
  })

  it("XP intermedio calcula la barra de progreso correctamente", () => {
    // Nivel 2 va de 150 a 400. 150+125 = 275 → 50% al siguiente.
    const info = getLevel(275)
    expect(info.level).toBe(2)
    expect(info.progressPct).toBe(50)
    expect(info.xpToNext).toBe(125)
  })

  it("XP máximo (≥ último umbral) marca progressPct=100 y nextLevelXp=null", () => {
    const last = LEVELS[LEVELS.length - 1]
    const info = getLevel(last.minXp)
    expect(info.level).toBe(MAX_LEVEL)
    expect(info.nextLevelXp).toBeNull()
    expect(info.progressPct).toBe(100)
    expect(info.xpToNext).toBe(0)
  })

  it("XP gigantesco se clava en MAX_LEVEL", () => {
    const info = getLevel(99_999_999)
    expect(info.level).toBe(MAX_LEVEL)
    expect(info.progressPct).toBe(100)
  })

  it("XP negativo o NaN se trata como 0 (defensive)", () => {
    expect(getLevel(-100).level).toBe(0)
    expect(getLevel(Number.NaN).level).toBe(0)
    expect(getLevel(Number.NEGATIVE_INFINITY).level).toBe(0)
  })

  it("Cada nivel apunta a su PNG correspondiente", () => {
    for (const lvl of LEVELS) {
      expect(getLevel(lvl.minXp).iconPath).toBe(`/streak/lvl-${lvl.level}.png`)
    }
  })
})

describe("computeExamXp", () => {
  it("examen normal terminado, mal aprobado → solo +10", () => {
    const items = computeExamXp({ mode: "normal", score: 20, total: 30 })
    expect(items).toEqual([{ reason: "exam-finish", amount: 10 }])
    expect(sumXp(items)).toBe(10)
  })

  it("examen normal aprobado (27/30) → +10 +20", () => {
    const items = computeExamXp({ mode: "normal", score: 27, total: 30 })
    expect(sumXp(items)).toBe(30)
    expect(items.map((i) => i.reason)).toEqual(["exam-finish", "exam-pass"])
  })

  it("examen normal perfecto (30/30) → +10 +50 (NO pasa por aprobado)", () => {
    const items = computeExamXp({ mode: "normal", score: 30, total: 30 })
    expect(sumXp(items)).toBe(60)
    expect(items.map((i) => i.reason)).toEqual(["exam-finish", "exam-perfect"])
  })

  it("examen de tema con N != 30 NO concede bonus de aprobado/perfecto", () => {
    // Test de tema con 10 preguntas, todas correctas — solo +10 base.
    const items = computeExamXp({ mode: "tema", score: 10, total: 10 })
    expect(sumXp(items)).toBe(10)
    expect(items.map((i) => i.reason)).toEqual(["exam-finish"])
  })

  it("modo errores → +5 fijo, sin bonus de aprobado aunque saque 30/30", () => {
    const items = computeExamXp({ mode: "errores", score: 30, total: 30 })
    expect(items).toEqual([{ reason: "exam-errores", amount: 5 }])
  })

  it("modo errores-refuerzo idéntico al modo errores", () => {
    const items = computeExamXp({ mode: "errores-refuerzo", score: 5, total: 30 })
    expect(items).toEqual([{ reason: "exam-errores", amount: 5 }])
  })

  it("frontera 26 vs 27 — 26 no aprueba, 27 sí", () => {
    expect(sumXp(computeExamXp({ mode: "normal", score: 26, total: 30 }))).toBe(10)
    expect(sumXp(computeExamXp({ mode: "normal", score: 27, total: 30 }))).toBe(30)
  })

  it("frontera 29 vs 30 — 29 da aprobado, 30 da perfecto", () => {
    expect(sumXp(computeExamXp({ mode: "normal", score: 29, total: 30 }))).toBe(30)
    expect(sumXp(computeExamXp({ mode: "normal", score: 30, total: 30 }))).toBe(60)
  })
})
