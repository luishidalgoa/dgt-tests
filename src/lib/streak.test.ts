import { describe, it, expect } from "vitest"
import {
  computeStreakState,
  computeStreakDaysOnly,
  awardStreakCreditIfMilestone,
  yesterdayMidnight,
  MAX_RESTORE_CREDITS,
} from "./streak"

// Fecha fija "hoy" para los tests — un miércoles a media tarde. Todas las
// fechas de attempts se construyen relativas a esto.
const NOW = new Date("2026-05-20T15:30:00")
const MS_PER_DAY = 86_400_000

function dayAgo(n: number, hour = 12): Date {
  const todayMid = new Date(NOW)
  todayMid.setHours(0, 0, 0, 0)
  const d = new Date(todayMid.getTime() - n * MS_PER_DAY)
  d.setHours(hour, 0, 0, 0)
  return d
}

function midnightAgo(n: number): Date {
  const todayMid = new Date(NOW)
  todayMid.setHours(0, 0, 0, 0)
  return new Date(todayMid.getTime() - n * MS_PER_DAY)
}

describe("computeStreakState — last7 básico", () => {
  it("array de 7 días con hoy a la derecha", () => {
    const s = computeStreakState([], null, NOW)
    expect(s.last7).toHaveLength(7)
    expect(s.last7[6].isToday).toBe(true)
    expect(s.last7.slice(0, 6).every(d => !d.isToday)).toBe(true)
  })

  it("cuenta attempts del día correcto", () => {
    const s = computeStreakState(
      [dayAgo(0), dayAgo(0, 18), dayAgo(2), dayAgo(6)],
      null,
      NOW,
    )
    expect(s.last7[6].count).toBe(2) // hoy
    expect(s.last7[5].count).toBe(0) // ayer
    expect(s.last7[4].count).toBe(1) // anteayer
    expect(s.last7[0].count).toBe(1) // hace 6 días
  })

  it("weekTotal y dailyAvg correctos", () => {
    const s = computeStreakState(
      [dayAgo(0), dayAgo(1), dayAgo(2)],
      null,
      NOW,
    )
    expect(s.weekTotal).toBe(3)
    expect(s.dailyAvg).toBeCloseTo(3 / 7)
  })

  it("attempts fuera de los 7 días se ignoran", () => {
    const s = computeStreakState([dayAgo(8), dayAgo(0)], null, NOW)
    expect(s.weekTotal).toBe(1)
  })
})

describe("computeStreakState — streakDays", () => {
  it("0 si hoy y ayer están vacíos", () => {
    const s = computeStreakState([dayAgo(3)], null, NOW)
    expect(s.streakDays).toBe(0)
  })

  it("cuenta días contiguos hacia atrás desde hoy", () => {
    const s = computeStreakState(
      [dayAgo(0), dayAgo(1), dayAgo(2)],
      null,
      NOW,
    )
    expect(s.streakDays).toBe(3)
  })

  it("se corta en el primer día vacío", () => {
    const s = computeStreakState(
      [dayAgo(0), dayAgo(1), dayAgo(3), dayAgo(4)],
      null,
      NOW,
    )
    expect(s.streakDays).toBe(2)
  })

  it("racha de 7 días llena", () => {
    const s = computeStreakState(
      [0, 1, 2, 3, 4, 5, 6].map(n => dayAgo(n)),
      null,
      NOW,
    )
    expect(s.streakDays).toBe(7)
  })

  it("varios attempts el mismo día no inflan la racha", () => {
    const s = computeStreakState(
      [dayAgo(0), dayAgo(0, 9), dayAgo(0, 18), dayAgo(1)],
      null,
      NOW,
    )
    expect(s.streakDays).toBe(2)
  })
})

describe("computeStreakState — frozen (estado del icono)", () => {
  it("frozen=true cuando hoy no hay examen", () => {
    const s = computeStreakState([dayAgo(1), dayAgo(2)], null, NOW)
    expect(s.frozen).toBe(true)
  })

  it("frozen=false cuando hoy hay >=1 examen", () => {
    const s = computeStreakState([dayAgo(0)], null, NOW)
    expect(s.frozen).toBe(false)
  })

  it("frozen=true SIN restoredUntil (sin créditos) sigue siendo true", () => {
    const s = computeStreakState([], null, NOW)
    expect(s.frozen).toBe(true)
  })
})

describe("computeStreakState — restoredUntil cuenta como hecho en la racha", () => {
  it("ayer restaurado + hoy hecho → streak 2", () => {
    const s = computeStreakState(
      [dayAgo(0), dayAgo(2)],
      midnightAgo(1),
      NOW,
      { credits: 0 },
    )
    expect(s.streakDays).toBe(3) // hoy + ayer(restored) + anteayer
    expect(s.last7[5].restored).toBe(true)
    expect(s.last7[5].count).toBe(0)
  })

  it("ayer restaurado pero hoy aún sin examen → streak igual sigue", () => {
    const s = computeStreakState(
      [dayAgo(2)],
      midnightAgo(1),
      NOW,
      { credits: 0 },
    )
    // hoy.count=0 y NO restaurado → racha=0 desde hoy
    expect(s.streakDays).toBe(0)
    expect(s.frozen).toBe(true)
  })

  it("restoredUntil de hace 3 días no aplica si no es ayer", () => {
    // restoredUntil = hace 3 días, pero ese día ya tenía examen → restored=false
    const s = computeStreakState(
      [dayAgo(3), dayAgo(0)],
      midnightAgo(3),
      NOW,
    )
    expect(s.last7[3].restored).toBe(false) // ya tenía count > 0
  })
})

describe("computeStreakState — canRestore (eligibilidad)", () => {
  it("eligible: ayer roto, anteayer hecho, credits>0, sin restored previo", () => {
    const s = computeStreakState(
      [dayAgo(2), dayAgo(3)],
      null,
      NOW,
      { credits: 1 },
    )
    expect(s.canRestore).toBe(true)
  })

  it("NO eligible si no hay créditos", () => {
    const s = computeStreakState(
      [dayAgo(2), dayAgo(3)],
      null,
      NOW,
      { credits: 0 },
    )
    expect(s.canRestore).toBe(false)
  })

  it("NO eligible si anteayer también está vacío (rotura de 2+ días)", () => {
    const s = computeStreakState(
      [dayAgo(3)],
      null,
      NOW,
      { credits: 5 },
    )
    expect(s.canRestore).toBe(false)
  })

  it("NO eligible si ayer ya está restaurado", () => {
    const s = computeStreakState(
      [dayAgo(2)],
      midnightAgo(1),
      NOW,
      { credits: 5 },
    )
    expect(s.canRestore).toBe(false)
  })

  it("NO eligible si ayer SÍ hay examen (no hay rotura)", () => {
    const s = computeStreakState(
      [dayAgo(1), dayAgo(2)],
      null,
      NOW,
      { credits: 5 },
    )
    expect(s.canRestore).toBe(false)
  })

  it("rotura tras restaurar: NO se puede gastar 2 créditos seguidos", () => {
    // Usuario restauró hace 2 días (= "ayer" desde la perspectiva de
    // ayer). Hoy y ayer no hay examen → ayer está roto, anteayer es el
    // día restaurado anteriormente (sin examen real). NO debe poder
    // restaurar de nuevo.
    const s = computeStreakState(
      [dayAgo(3)],
      midnightAgo(2),
      NOW,
      { credits: 5 },
    )
    expect(s.canRestore).toBe(false)
  })

  it("NO eligible si hoy YA tiene examen real (racha nueva ya empezada)", () => {
    // Usuario hizo el examen hoy primero → cobró D1=+5 de la racha
    // nueva. Restaurar la vieja ahora es semánticamente confuso (¿se
    // fusionan los días? ¿se paga D? retroactivo?). Forzamos a que
    // restaure ANTES de jugar para que la economía quede limpia.
    const s = computeStreakState(
      [dayAgo(0), dayAgo(2)], // hoy + anteayer reales, ayer roto
      null,
      NOW,
      { credits: 5 },
    )
    expect(s.canRestore).toBe(false)
  })
})

describe("computeStreakDaysOnly", () => {
  it("devuelve solo el número de la racha", () => {
    const n = computeStreakDaysOnly(
      [dayAgo(0), dayAgo(1)],
      null,
      NOW,
    )
    expect(n).toBe(2)
  })
})

describe("awardStreakCreditIfMilestone", () => {
  it("+1 al cruzar 7", () => {
    expect(awardStreakCreditIfMilestone(6, 7, 1)).toBe(2)
  })

  it("+1 al cruzar 14, 21, 28...", () => {
    expect(awardStreakCreditIfMilestone(13, 14, 0)).toBe(1)
    expect(awardStreakCreditIfMilestone(20, 21, 3)).toBe(4)
  })

  it("no premia si la racha no avanza (segundo examen del mismo día)", () => {
    expect(awardStreakCreditIfMilestone(7, 7, 1)).toBe(1)
  })

  it("no premia si newStreak no es múltiplo de 7", () => {
    expect(awardStreakCreditIfMilestone(2, 3, 0)).toBe(0)
    expect(awardStreakCreditIfMilestone(7, 8, 0)).toBe(0)
  })

  it("respeta el tope MAX_RESTORE_CREDITS", () => {
    expect(awardStreakCreditIfMilestone(6, 7, MAX_RESTORE_CREDITS)).toBe(
      MAX_RESTORE_CREDITS,
    )
  })
})

describe("yesterdayMidnight", () => {
  it("devuelve medianoche del día anterior", () => {
    const y = yesterdayMidnight(NOW)
    expect(y.getHours()).toBe(0)
    expect(y.getMinutes()).toBe(0)
    expect(y.getSeconds()).toBe(0)
    expect(y.getDate()).toBe(NOW.getDate() - 1)
  })
})
