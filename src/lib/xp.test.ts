/**
 * Tests puros sobre los helpers de XP. NO toca BBDD — `awardXp`,
 * `awardDailyStreakBonusIfDue` y `getCurrentStreakLength` son
 * integraciones y se cubrirán aparte.
 */

import { describe, it, expect } from "vitest"
import {
  LEVELS,
  MAX_LEVEL,
  STREAK_DAY_BONUSES,
  computeExamXp,
  computeStreakDayBonus,
  getLevel,
  sumXp,
} from "./xp"

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

describe("computeExamXp — base 15, -1.5 por error", () => {
  it("examen perfecto (0 errores) → 15 XP", () => {
    const items = computeExamXp({ score: 30, total: 30 })
    expect(items).toEqual([{ reason: "exam-finish", amount: 15 }])
    expect(sumXp(items)).toBe(15)
  })

  it("aprobado mínimo (27/30 → 3 errores) → round(15 - 4.5) = 11 XP", () => {
    // 15 - 1.5*3 = 10.5 → Math.round = 11 (round-half-up)
    expect(sumXp(computeExamXp({ score: 27, total: 30 }))).toBe(11)
  })

  it("1 error → round(15 - 1.5) = 14 XP", () => {
    // 13.5 → Math.round = 14 (round-half-up)
    expect(sumXp(computeExamXp({ score: 29, total: 30 }))).toBe(14)
  })

  it("2 errores → 12 XP", () => {
    expect(sumXp(computeExamXp({ score: 28, total: 30 }))).toBe(12)
  })

  it("10 errores → 0 XP (clamp en cero)", () => {
    expect(sumXp(computeExamXp({ score: 20, total: 30 }))).toBe(0)
  })

  it("examen catastrófico (30 errores) → 0 XP, sin negativo", () => {
    expect(sumXp(computeExamXp({ score: 0, total: 30 }))).toBe(0)
  })

  it("aplica también a tests de tema con N != 30", () => {
    // Test de 10 preguntas, 1 error: 15 - 1.5 = 13.5 → 14
    expect(sumXp(computeExamXp({ score: 9, total: 10 }))).toBe(14)
    // Test de 10 preguntas, todas mal: 15 - 15 = 0
    expect(sumXp(computeExamXp({ score: 0, total: 10 }))).toBe(0)
  })

  it("score > total (caso anómalo) se trata como 0 errores → 15 XP", () => {
    // No deberíamos llegar aquí, pero defensive: max(0, total-score)
    expect(sumXp(computeExamXp({ score: 35, total: 30 }))).toBe(15)
  })
})

describe("computeStreakDayBonus — ciclo de 7 días", () => {
  it("día 0 o negativo → 0 XP", () => {
    expect(computeStreakDayBonus(0)).toBe(0)
    expect(computeStreakDayBonus(-1)).toBe(0)
    expect(computeStreakDayBonus(Number.NaN)).toBe(0)
  })

  it("primeros 7 días siguen la tabla [5,7,10,15,20,30,50]", () => {
    expect(computeStreakDayBonus(1)).toBe(5)
    expect(computeStreakDayBonus(2)).toBe(7)
    expect(computeStreakDayBonus(3)).toBe(10)
    expect(computeStreakDayBonus(4)).toBe(15)
    expect(computeStreakDayBonus(5)).toBe(20)
    expect(computeStreakDayBonus(6)).toBe(30)
    expect(computeStreakDayBonus(7)).toBe(50)
  })

  it("día 8 vuelve a 5 (loop), día 9 a 7, día 14 a 50, día 15 a 5", () => {
    expect(computeStreakDayBonus(8)).toBe(5)
    expect(computeStreakDayBonus(9)).toBe(7)
    expect(computeStreakDayBonus(14)).toBe(50)
    expect(computeStreakDayBonus(15)).toBe(5)
    expect(computeStreakDayBonus(21)).toBe(50)
    expect(computeStreakDayBonus(22)).toBe(5)
  })

  it("la tabla expuesta como constante coincide con los valores spec'd", () => {
    expect(Array.from(STREAK_DAY_BONUSES)).toEqual([5, 7, 10, 15, 20, 30, 50])
    expect(STREAK_DAY_BONUSES.reduce((a, b) => a + b, 0)).toBe(137)
  })
})
