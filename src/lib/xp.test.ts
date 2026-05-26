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
  buildCycleView,
  computeExamXp,
  computeRestoreTargetDays,
  computeStreakDayBonus,
  computeStreakStateFromData,
  getLevel,
  sumXp,
} from "./xp"

/** Crea un Date en una fecha dada manteniendo zona local. */
const dateAt = (y: number, m: number, d: number, h = 12): Date =>
  new Date(y, m - 1, d, h)

/** Fecha base para los tests de racha: 24 mayo 2026 a las 14:00 (mediodía). */
const NOW = dateAt(2026, 5, 24, 14)

/** Construye un attempt fictício en un delta de días respecto a NOW.
 *  -1 = ayer, -7 = hace una semana. La hora se fija a las 10am para que
 *  midnight(NOW) - 86400000 == midnight(daysAgo(1)) sin ambigüedad. */
const daysAgo = (n: number): Date => {
  const t = new Date(NOW)
  t.setDate(t.getDate() - n)
  t.setHours(10, 0, 0, 0)
  return t
}
/** Medianoche local de N días atrás (para restoredUntil). */
const midnightDaysAgo = (n: number): Date => {
  const t = new Date(NOW)
  t.setDate(t.getDate() - n)
  t.setHours(0, 0, 0, 0)
  return t
}

describe("getLevel", () => {
  it("XP = 0 → nivel 0 con barra al 0%", () => {
    const info = getLevel(0)
    expect(info.level).toBe(0)
    expect(info.iconPath).toBe(LEVELS[0].iconPath)
    expect(info.minXp).toBe(0)
    expect(info.nextLevelXp).toBe(50)
    expect(info.xpToNext).toBe(50)
    expect(info.progressPct).toBe(0)
  })

  it("XP justo en el umbral del nivel siguiente sube de nivel", () => {
    // 50 XP exactos = lvl 1
    const info = getLevel(50)
    expect(info.level).toBe(1)
    expect(info.iconPath).toBe(LEVELS[1].iconPath)
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

  it("Cada nivel apunta al iconPath declarado en LEVELS", () => {
    // No hard-codeamos la convención de naming (algunos PNGs usan
    // legacy "lvl-N" y los nuevos "level-N"); solo verificamos que el
    // path devuelto por getLevel coincide con el declarado en la tabla.
    for (const lvl of LEVELS) {
      expect(getLevel(lvl.minXp).iconPath).toBe(lvl.iconPath)
      expect(getLevel(lvl.minXp).iconPath).toMatch(/^\/streak\/(lvl|level)-\d+\.png$/)
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

describe("buildCycleView — visualización del ciclo de 7 días", () => {
  it("dormant: 0 ganados, día 1 marcado como hoy (pendiente)", () => {
    const slots = buildCycleView({ state: "dormant", days: 0, claimedToday: false })
    expect(slots).toHaveLength(7)
    expect(slots.filter((s) => s.isEarned)).toHaveLength(0)
    const todays = slots.filter((s) => s.isToday)
    expect(todays).toHaveLength(1)
    expect(todays[0].day).toBe(1)
    expect(todays[0].bonus).toBe(5)
  })

  it("active día 4 con bonus cobrado: días 1-4 earned, día 4 también es hoy", () => {
    const slots = buildCycleView({ state: "active", days: 4, claimedToday: true })
    expect(slots.filter((s) => s.isEarned).map((s) => s.day)).toEqual([1, 2, 3, 4])
    const todays = slots.filter((s) => s.isToday)
    expect(todays).toHaveLength(1)
    expect(todays[0].day).toBe(4)
    expect(todays[0].isEarned).toBe(true)
  })

  it("active día 4 SIN cobrar (transitorio): días 1-3 earned, día 4 = hoy pendiente", () => {
    const slots = buildCycleView({ state: "active", days: 4, claimedToday: false })
    expect(slots.filter((s) => s.isEarned).map((s) => s.day)).toEqual([1, 2, 3])
    const todays = slots.filter((s) => s.isToday)
    expect(todays).toHaveLength(1)
    expect(todays[0].day).toBe(4)
    expect(todays[0].isEarned).toBe(false)
  })

  it("frozen con 3 días hasta ayer: 1-3 earned, día 4 marcado como hoy pendiente", () => {
    const slots = buildCycleView({ state: "frozen", days: 3, claimedToday: false })
    expect(slots.filter((s) => s.isEarned).map((s) => s.day)).toEqual([1, 2, 3])
    const todays = slots.filter((s) => s.isToday)
    expect(todays).toHaveLength(1)
    expect(todays[0].day).toBe(4)
    expect(todays[0].bonus).toBe(15)
    expect(todays[0].isEarned).toBe(false)
  })

  it("frozen con ciclo completo (7 días): 7 earned, ningún chip de hoy en este ciclo", () => {
    const slots = buildCycleView({ state: "frozen", days: 7, claimedToday: false })
    expect(slots.filter((s) => s.isEarned)).toHaveLength(7)
    expect(slots.filter((s) => s.isToday)).toHaveLength(0)
  })

  it("active día 8 (loop): vuelve al día 1 del nuevo ciclo", () => {
    const slots = buildCycleView({ state: "active", days: 8, claimedToday: true })
    expect(slots.filter((s) => s.isEarned).map((s) => s.day)).toEqual([1])
    expect(slots.find((s) => s.isToday)?.day).toBe(1)
    expect(slots.find((s) => s.isToday)?.bonus).toBe(5)
  })

  it("active día 14 (final segundo ciclo): los 7 earned, el último es hoy", () => {
    const slots = buildCycleView({ state: "active", days: 14, claimedToday: true })
    expect(slots.filter((s) => s.isEarned)).toHaveLength(7)
    expect(slots.find((s) => s.isToday)?.day).toBe(7)
    expect(slots.find((s) => s.isToday)?.bonus).toBe(50)
  })

  it("cada slot tiene el bonus correcto correspondiente a su posición", () => {
    const slots = buildCycleView({ state: "dormant", days: 0, claimedToday: false })
    expect(slots.map((s) => s.bonus)).toEqual([5, 7, 10, 15, 20, 30, 50])
  })
})

describe("computeStreakStateFromData — detección active/frozen/dormant", () => {
  // ── DORMANT ──────────────────────────────────────────────────────
  it("dormant: sin attempts → state=dormant, days=0", () => {
    const s = computeStreakStateFromData({
      attemptDates:  [],
      restoredUntil: null,
      lastBonusAt:   null,
      now:           NOW,
    })
    expect(s).toEqual({ state: "dormant", days: 0, claimedToday: false })
  })

  it("dormant: attempts hace 3+ días (ni hoy ni ayer) → dormant", () => {
    const s = computeStreakStateFromData({
      attemptDates:  [daysAgo(3), daysAgo(5), daysAgo(10)],
      restoredUntil: null,
      lastBonusAt:   null,
      now:           NOW,
    })
    expect(s.state).toBe("dormant")
    expect(s.days).toBe(0)
  })

  // ── ACTIVE ───────────────────────────────────────────────────────
  it("active: solo hoy → days=1, claimedToday según lastBonusAt", () => {
    const s = computeStreakStateFromData({
      attemptDates:  [daysAgo(0)],
      restoredUntil: null,
      lastBonusAt:   null,
      now:           NOW,
    })
    expect(s.state).toBe("active")
    expect(s.days).toBe(1)
    expect(s.claimedToday).toBe(false)
  })

  it("active: claimedToday=true cuando lastBonusAt es hoy", () => {
    const s = computeStreakStateFromData({
      attemptDates:  [daysAgo(0)],
      restoredUntil: null,
      lastBonusAt:   new Date(NOW.getTime() - 60_000), // hace 1 min, hoy
      now:           NOW,
    })
    expect(s.claimedToday).toBe(true)
  })

  it("active: claimedToday=false cuando lastBonusAt es ayer", () => {
    const s = computeStreakStateFromData({
      attemptDates:  [daysAgo(0), daysAgo(1)],
      restoredUntil: null,
      lastBonusAt:   daysAgo(1),
      now:           NOW,
    })
    expect(s.state).toBe("active")
    expect(s.claimedToday).toBe(false)
  })

  it("active: hoy + 6 días consecutivos → days=7 (ciclo completo)", () => {
    const s = computeStreakStateFromData({
      attemptDates:  [0, 1, 2, 3, 4, 5, 6].map(daysAgo),
      restoredUntil: null,
      lastBonusAt:   NOW,
      now:           NOW,
    })
    expect(s.state).toBe("active")
    expect(s.days).toBe(7)
  })

  it("active: hoy + 13 días seguidos → days=14 (segundo ciclo)", () => {
    const s = computeStreakStateFromData({
      attemptDates:  Array.from({ length: 14 }, (_, i) => daysAgo(i)),
      restoredUntil: null,
      lastBonusAt:   NOW,
      now:           NOW,
    })
    expect(s.days).toBe(14)
  })

  it("active: cadena se rompe en hueco intermedio → cuenta solo desde hoy hasta el gap", () => {
    // Hoy, ayer, anteayer, GAP, -4, -5
    const s = computeStreakStateFromData({
      attemptDates:  [daysAgo(0), daysAgo(1), daysAgo(2), daysAgo(4), daysAgo(5)],
      restoredUntil: null,
      lastBonusAt:   null,
      now:           NOW,
    })
    expect(s.state).toBe("active")
    expect(s.days).toBe(3) // 0, -1, -2
  })

  // ── FROZEN ───────────────────────────────────────────────────────
  it("frozen: solo ayer → state=frozen, days=1, claimedToday=false", () => {
    const s = computeStreakStateFromData({
      attemptDates:  [daysAgo(1)],
      restoredUntil: null,
      lastBonusAt:   null,
      now:           NOW,
    })
    expect(s.state).toBe("frozen")
    expect(s.days).toBe(1)
    expect(s.claimedToday).toBe(false)
  })

  it("frozen: ayer + 4 días previos → days=5", () => {
    const s = computeStreakStateFromData({
      attemptDates:  [1, 2, 3, 4, 5].map(daysAgo),
      restoredUntil: null,
      lastBonusAt:   null,
      now:           NOW,
    })
    expect(s.state).toBe("frozen")
    expect(s.days).toBe(5)
  })

  it("frozen: lastBonusAt 'de hoy' se ignora si no hay actividad real hoy", () => {
    // Caso defensivo: la BBDD podría tener un lastBonusAt fantasma por
    // desfase horario, pero si HOY no hay attempt, claimedToday=false.
    const s = computeStreakStateFromData({
      attemptDates:  [daysAgo(1)],
      restoredUntil: null,
      lastBonusAt:   NOW,
      now:           NOW,
    })
    expect(s.state).toBe("frozen")
    expect(s.claimedToday).toBe(false)
  })

  // ── RESTORED DAYS ────────────────────────────────────────────────
  it("active: hoy + ayer restaurado + anteayer real → days=3", () => {
    const s = computeStreakStateFromData({
      attemptDates:  [daysAgo(0), daysAgo(2)],
      restoredUntil: midnightDaysAgo(1),
      lastBonusAt:   null,
      now:           NOW,
    })
    expect(s.state).toBe("active")
    expect(s.days).toBe(3) // 0, -1 restored, -2
  })

  it("frozen: ayer SOLO restaurado (sin attempt real ese día) → days=1", () => {
    const s = computeStreakStateFromData({
      attemptDates:  [],
      restoredUntil: midnightDaysAgo(1),
      lastBonusAt:   null,
      now:           NOW,
    })
    expect(s.state).toBe("frozen")
    expect(s.days).toBe(1)
  })

  it("active: ayer restaurado pero anteayer NO existe → days=2 (rompe en -2)", () => {
    // Hoy + ayer restaurado, pero -2 sin actividad → la cadena rompe
    const s = computeStreakStateFromData({
      attemptDates:  [daysAgo(0)],
      restoredUntil: midnightDaysAgo(1),
      lastBonusAt:   null,
      now:           NOW,
    })
    expect(s.state).toBe("active")
    expect(s.days).toBe(2)
  })

  it("restoredUntil de hace 5 días NO cierra hueco de los últimos 3 días", () => {
    // Hoy y ayer existen, hace 2/3/4 días NO, hace 5 días restaurado.
    // El restore solo cubre 1 día, no rellena 3 huecos consecutivos.
    const s = computeStreakStateFromData({
      attemptDates:  [daysAgo(0), daysAgo(1)],
      restoredUntil: midnightDaysAgo(5),
      lastBonusAt:   null,
      now:           NOW,
    })
    expect(s.state).toBe("active")
    expect(s.days).toBe(2) // cadena se rompe en -2 (sin actividad ni restore)
  })

  it("active: día restaurado coincide con día que también tiene attempt (no rompe)", () => {
    // Caso patológico: alguien gastó un crédito en un día que SÍ tenía
    // attempt. No debe contar doble, pero tampoco romper la cadena.
    const s = computeStreakStateFromData({
      attemptDates:  [daysAgo(0), daysAgo(1)],
      restoredUntil: midnightDaysAgo(1), // mismo día que un attempt real
      lastBonusAt:   null,
      now:           NOW,
    })
    expect(s.state).toBe("active")
    expect(s.days).toBe(2)
  })

  // ── EDGE: attempts del mismo día se deduplican ──────────────────
  it("varios attempts el mismo día cuentan como 1 día de racha", () => {
    const s = computeStreakStateFromData({
      attemptDates:  [
        new Date(NOW.getTime()),                    // hoy 14:00
        new Date(NOW.getTime() - 60_000),           // hoy 13:59
        new Date(NOW.getTime() - 3_600_000),        // hoy 13:00
      ],
      restoredUntil: null,
      lastBonusAt:   null,
      now:           NOW,
    })
    expect(s.days).toBe(1)
  })
})

describe("computeRestoreTargetDays — qué chips se iluminarán al restaurar", () => {
  it("dormant + 2 días previos reales (Jue+Vie) → ilumina D1-D3 [caso bug del user]", () => {
    // Caso real del bug que motivó esta función: hoy y ayer sin actividad,
    // pero anteayer y hace 3 días sí. Restaurar ayer reconecta la cadena
    // a 3 días total (frozen, days=3) → buildCycleView marca D1, D2, D3
    // como earned. Antes no había nada earned → diff = [1, 2, 3].
    const targets = computeRestoreTargetDays({
      attemptDates:         [daysAgo(2), daysAgo(3)],
      currentRestoredUntil: null,
      now:                  NOW,
    })
    expect(targets).toEqual([1, 2, 3])
  })

  it("dormant + solo anteayer real → cadena de 2, ilumina D1 y D2", () => {
    const targets = computeRestoreTargetDays({
      attemptDates:         [daysAgo(2)],
      currentRestoredUntil: null,
      now:                  NOW,
    })
    expect(targets).toEqual([1, 2])
  })

  it("dormant sin attempts → restaurar ayer crea cadena de 1, ilumina D1", () => {
    // Aunque canRestore=false en streak.ts si no hay anteayer real, la
    // función pura sigue calculando: restoredUntil=ayer hace que la
    // cadena sea {-1 restored} → days=1 → D1 earned.
    const targets = computeRestoreTargetDays({
      attemptDates:         [],
      currentRestoredUntil: null,
      now:                  NOW,
    })
    expect(targets).toEqual([1])
  })

  it("ya con restoredUntil=ayer → cadena ya incluye ayer, no hay delta", () => {
    const targets = computeRestoreTargetDays({
      attemptDates:         [daysAgo(2)],
      currentRestoredUntil: midnightDaysAgo(1),
      now:                  NOW,
    })
    expect(targets).toEqual([])
  })

  it("dormant + 6 días previos reales → cadena de 7, ilumina ciclo completo D1-D7", () => {
    // Restaurar ayer + 6 previos = 7 días total. buildCycleView con
    // days=7 marca todos los chips D1-D7 como earned.
    const targets = computeRestoreTargetDays({
      attemptDates:         [2, 3, 4, 5, 6, 7].map(daysAgo),
      currentRestoredUntil: null,
      now:                  NOW,
    })
    expect(targets).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it("dormant + 7 días previos reales → cycle wrap, solo ilumina D1 del nuevo ciclo", () => {
    // Cadena tras restaurar = 8 días. (8-1) % 7 = 0 → pos=1. El ciclo
    // visualizador solo muestra el ciclo MÁS RECIENTE, así que solo D1
    // está earned. La animación NO debe iluminar D2-D7.
    const targets = computeRestoreTargetDays({
      attemptDates:         [2, 3, 4, 5, 6, 7, 8].map(daysAgo),
      currentRestoredUntil: null,
      now:                  NOW,
    })
    expect(targets).toEqual([1])
  })

  it("hoy con actividad + ayer roto + 2 reales previos → reconecta a cadena de 4, ilumina D2-D4", () => {
    // Pre-restore: active days=1 (solo hoy). buildCycleView con
    // claimedToday=false marca D1 como today-pending, no earned.
    // Post-restore: chain = hoy + ayer_restored + dos previos = 4 días.
    // buildCycleView frozen... espera, today tiene actividad → active.
    // active days=4 claimedToday=false → earnedThroughDay=3 (D1-D3),
    // D4=today-pending.
    // Diff: D1, D2, D3 son nuevos earned. (D1 pasó de pending → earned).
    const targets = computeRestoreTargetDays({
      attemptDates:         [daysAgo(0), daysAgo(2), daysAgo(3)],
      currentRestoredUntil: null,
      now:                  NOW,
    })
    expect(targets).toEqual([1, 2, 3])
  })
})
