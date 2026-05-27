/**
 * Tests de integración para las funciones de xp.ts que tocan BBDD:
 *   - `awardXp`                    — increment atómico + detección de level-up.
 *   - `getStreakState`             — wrapper async sobre la función pura.
 *   - `awardDailyStreakBonusIfDue` — cobra el bonus diario una vez por día.
 *
 * Patrón: mismo que `aiQuota.integration.test.ts` — `vi.hoisted` con un
 * mock de `@/lib/db` para evitar levantar Prisma real.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const dbMocks = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update:     vi.fn(),
  },
  examAttempt: {
    findMany: vi.fn(),
  },
}))

vi.mock("@/lib/db", () => ({ db: dbMocks }))

import {
  awardDailyStreakBonusIfDue,
  awardXp,
  getStreakState,
} from "./xp"

beforeEach(() => {
  dbMocks.user.findUnique.mockReset()
  dbMocks.user.update.mockReset()
  dbMocks.examAttempt.findMany.mockReset()
})

// ────────────────────────────────────────────────────────────────────────
// awardXp
// ────────────────────────────────────────────────────────────────────────
describe("awardXp — increment + level-up detection", () => {
  it("incrementa XP y devuelve el nuevo estado (sin level-up)", async () => {
    // User estaba en 30 XP (nivel 0). +10 → 40 XP, todavía nivel 0.
    dbMocks.user.update.mockResolvedValue({ xp: 40 })
    const r = await awardXp(7, 10, "exam-finish")
    expect(dbMocks.user.update).toHaveBeenCalledWith({
      where:  { id: 7 },
      data:   { xp: { increment: 10 } },
      select: { xp: true },
    })
    expect(r.oldXp).toBe(30)
    expect(r.newXp).toBe(40)
    expect(r.oldLevel).toBe(0)
    expect(r.newLevel).toBe(0)
    expect(r.leveledUp).toBe(false)
    expect(r.levelInfo.level).toBe(0)
  })

  it("detecta level-up al cruzar un umbral (40 → 60 cruza lvl 1 en 50)", async () => {
    dbMocks.user.update.mockResolvedValue({ xp: 60 })
    const r = await awardXp(7, 20, "exam-finish")
    expect(r.oldXp).toBe(40)
    expect(r.newXp).toBe(60)
    expect(r.oldLevel).toBe(0)
    expect(r.newLevel).toBe(1)
    expect(r.leveledUp).toBe(true)
  })

  it("una sola llamada puede saltar varios niveles si el amount es grande", async () => {
    // 30 → 500: cruza lvl 1 (50), lvl 2 (150), lvl 3 (400).
    dbMocks.user.update.mockResolvedValue({ xp: 500 })
    const r = await awardXp(7, 470, "exam-finish")
    expect(r.oldLevel).toBe(0)
    expect(r.newLevel).toBe(3)
    expect(r.leveledUp).toBe(true)
  })

  it("amount=0 es no-op: lee xp actual y devuelve sin incrementar", async () => {
    dbMocks.user.findUnique.mockResolvedValue({ xp: 100 })
    const r = await awardXp(7, 0, "exam-finish")
    expect(dbMocks.user.update).not.toHaveBeenCalled()
    expect(dbMocks.user.findUnique).toHaveBeenCalled()
    expect(r.newXp).toBe(100)
    expect(r.oldXp).toBe(100)
    expect(r.leveledUp).toBe(false)
  })

  it("amount negativo es no-op (defensa contra bugs aguas arriba)", async () => {
    dbMocks.user.findUnique.mockResolvedValue({ xp: 100 })
    const r = await awardXp(7, -50, "exam-finish")
    expect(dbMocks.user.update).not.toHaveBeenCalled()
    expect(r.newXp).toBe(100)
  })

  it("no-op cuando el user no existe → arranca como xp=0", async () => {
    dbMocks.user.findUnique.mockResolvedValue(null)
    const r = await awardXp(999, 0, "exam-finish")
    expect(r.newXp).toBe(0)
    expect(r.oldXp).toBe(0)
    expect(r.levelInfo.level).toBe(0)
  })
})

// ────────────────────────────────────────────────────────────────────────
// getStreakState (wrapper)
// ────────────────────────────────────────────────────────────────────────
describe("getStreakState — wrapper async sobre la función pura", () => {
  it("hace la query con los flags correctos y delega bien", async () => {
    dbMocks.user.findUnique.mockResolvedValue({
      lastStreakBonusAt:    null,
      streakRestoredUntil:  null,
    })
    dbMocks.examAttempt.findMany.mockResolvedValue([])

    const s = await getStreakState(42)

    // Verifica la query del user (qué columnas se seleccionan)
    expect(dbMocks.user.findUnique).toHaveBeenCalledWith({
      where:  { id: 42 },
      select: { lastStreakBonusAt: true, streakRestoredUntil: true },
    })

    // Verifica la query de attempts (incluye el filtro de stats y el userId)
    const findArgs = dbMocks.examAttempt.findMany.mock.calls[0]?.[0] as
      | { where?: { userId?: number; mode?: { notIn?: string[] } }; select?: unknown }
      | undefined
    expect(findArgs?.where?.userId).toBe(42)
    expect(findArgs?.where?.mode?.notIn).toEqual(["errores", "errores-refuerzo"])

    // Sin attempts ni restored → dormant
    expect(s).toEqual({ state: "dormant", days: 0, claimedToday: false })
  })

  it("active con attempts hoy + ayer + restoredUntil null", async () => {
    // Anclamos a mediodía para que `now - 2h` no cruce medianoche y
    // siga siendo "hoy". Sin esto el test falla cuando vitest corre
    // entre 00:00–02:00 (la resta pasa al día anterior).
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    const now = today.getTime()
    dbMocks.user.findUnique.mockResolvedValue({
      lastStreakBonusAt:    new Date(now), // hoy → claimedToday=true
      streakRestoredUntil:  null,
    })
    dbMocks.examAttempt.findMany.mockResolvedValue([
      { startedAt: new Date(now - 2 * 3_600_000) },        // hoy hace 2h
      { startedAt: new Date(now - 26 * 3_600_000) },       // ayer
    ])

    const s = await getStreakState(1)
    expect(s.state).toBe("active")
    expect(s.days).toBeGreaterThanOrEqual(2)
    expect(s.claimedToday).toBe(true)
  })

  it("frozen con attempts solo ayer", async () => {
    // Anclamos a mediodía (ver test anterior — mismo motivo).
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    const now = today.getTime()
    dbMocks.user.findUnique.mockResolvedValue({
      lastStreakBonusAt:    null,
      streakRestoredUntil:  null,
    })
    dbMocks.examAttempt.findMany.mockResolvedValue([
      { startedAt: new Date(now - 26 * 3_600_000) },       // ayer
    ])

    const s = await getStreakState(1)
    expect(s.state).toBe("frozen")
    expect(s.days).toBe(1)
    expect(s.claimedToday).toBe(false)
  })

  it("user inexistente → dormant con claimedToday=false", async () => {
    dbMocks.user.findUnique.mockResolvedValue(null)
    dbMocks.examAttempt.findMany.mockResolvedValue([])
    const s = await getStreakState(999)
    expect(s.state).toBe("dormant")
    expect(s.claimedToday).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────
// awardDailyStreakBonusIfDue
// ────────────────────────────────────────────────────────────────────────
describe("awardDailyStreakBonusIfDue — paga 1 vez por día si racha activa", () => {
  /** Setup helper: prepara los mocks para un usuario en estado dado. */
  function mockUser(opts: {
    lastStreakBonusAt:   Date | null
    streakRestoredUntil: Date | null
    todayAttempts:       boolean       // ¿hay attempt hoy?
    previousDays:        number        // nº de días previos consecutivos (sin hoy)
    xpAfterUpdate?:      number        // valor de xp tras el increment
  }) {
    dbMocks.user.findUnique.mockResolvedValue({
      lastStreakBonusAt:    opts.lastStreakBonusAt,
      streakRestoredUntil:  opts.streakRestoredUntil,
    })
    const now = Date.now()
    const attempts: { startedAt: Date }[] = []
    if (opts.todayAttempts) attempts.push({ startedAt: new Date(now - 60_000) })
    for (let i = 1; i <= opts.previousDays; i++) {
      attempts.push({ startedAt: new Date(now - i * 86_400_000 - 60_000) })
    }
    dbMocks.examAttempt.findMany.mockResolvedValue(attempts)
    // El awardDailyStreakBonusIfDue hace 2 writes: update(lastStreakBonusAt)
    // y awardXp que hace update(xp). Distinguimos por el shape del data.
    dbMocks.user.update.mockImplementation(async (args: { data: { xp?: unknown; lastStreakBonusAt?: unknown } }) => {
      if (args.data.xp) return { xp: opts.xpAfterUpdate ?? 0 }
      return { lastStreakBonusAt: new Date() }
    })
  }

  it("paga +10 XP si es día 1 (solo hoy, sin claim previo)", async () => {
    mockUser({
      lastStreakBonusAt:   null,
      streakRestoredUntil: null,
      todayAttempts:       true,
      previousDays:        0,
      xpAfterUpdate:       10,
    })
    const r = await awardDailyStreakBonusIfDue(1)
    expect(r).not.toBeNull()
    expect(r!.newXp).toBe(10)

    // Verifica que se marcó lastStreakBonusAt (primer update sin xp)
    const updateCalls = dbMocks.user.update.mock.calls
    const markCall = updateCalls.find(([args]) => "lastStreakBonusAt" in (args as { data: object }).data)
    expect(markCall).toBeDefined()
    // Y que se incrementó el XP en +10
    const xpCall = updateCalls.find(([args]) => "xp" in (args as { data: object }).data)
    expect(xpCall?.[0]).toMatchObject({ data: { xp: { increment: 10 } } })
  })

  it("paga +100 si la racha es de 7 días", async () => {
    mockUser({
      lastStreakBonusAt:   null,
      streakRestoredUntil: null,
      todayAttempts:       true,
      previousDays:        6,
      xpAfterUpdate:       100,
    })
    const r = await awardDailyStreakBonusIfDue(1)
    expect(r!.newXp).toBe(100)
    const xpCall = dbMocks.user.update.mock.calls.find(
      ([args]) => "xp" in (args as { data: object }).data,
    )
    expect(xpCall?.[0]).toMatchObject({ data: { xp: { increment: 100 } } })
  })

  it("paga +10 si la racha es de 8 días (loop)", async () => {
    mockUser({
      lastStreakBonusAt:   null,
      streakRestoredUntil: null,
      todayAttempts:       true,
      previousDays:        7,
      xpAfterUpdate:       10,
    })
    const r = await awardDailyStreakBonusIfDue(1)
    expect(r!.newXp).toBe(10)
  })

  it("devuelve null si ya cobró el bonus hoy (claimedToday)", async () => {
    mockUser({
      lastStreakBonusAt:   new Date(),    // hoy mismo, ya pagado
      streakRestoredUntil: null,
      todayAttempts:       true,
      previousDays:        2,
    })
    const r = await awardDailyStreakBonusIfDue(1)
    expect(r).toBeNull()
    // No debería haber escrito nada
    expect(dbMocks.user.update).not.toHaveBeenCalled()
  })

  it("devuelve null si el estado es 'frozen' (hoy sin actividad)", async () => {
    mockUser({
      lastStreakBonusAt:   null,
      streakRestoredUntil: null,
      todayAttempts:       false,
      previousDays:        3,    // ayer + 2 días más, pero hoy no
    })
    const r = await awardDailyStreakBonusIfDue(1)
    expect(r).toBeNull()
    expect(dbMocks.user.update).not.toHaveBeenCalled()
  })

  it("devuelve null si el estado es 'dormant'", async () => {
    mockUser({
      lastStreakBonusAt:   null,
      streakRestoredUntil: null,
      todayAttempts:       false,
      previousDays:        0,
    })
    const r = await awardDailyStreakBonusIfDue(1)
    expect(r).toBeNull()
  })

  it("marca lastStreakBonusAt ANTES de pagar (evita doble-pago en race)", async () => {
    mockUser({
      lastStreakBonusAt:   null,
      streakRestoredUntil: null,
      todayAttempts:       true,
      previousDays:        0,
      xpAfterUpdate:       10,
    })
    await awardDailyStreakBonusIfDue(1)
    const calls = dbMocks.user.update.mock.calls
    // Primer update = marcar lastStreakBonusAt; segundo = incrementar XP.
    expect(calls[0]?.[0]).toMatchObject({ data: { lastStreakBonusAt: expect.any(Date) } })
    expect(calls[1]?.[0]).toMatchObject({ data: { xp: { increment: 10 } } })
  })

  it("user inexistente → null sin escribir", async () => {
    dbMocks.user.findUnique.mockResolvedValue(null)
    dbMocks.examAttempt.findMany.mockResolvedValue([])
    const r = await awardDailyStreakBonusIfDue(999)
    expect(r).toBeNull()
    expect(dbMocks.user.update).not.toHaveBeenCalled()
  })

  it("paga el bonus en estado active con día restaurado en la cadena", async () => {
    const now = Date.now()
    const yesterdayMid = new Date(now)
    yesterdayMid.setHours(0, 0, 0, 0)
    yesterdayMid.setDate(yesterdayMid.getDate() - 1)

    // Hoy + restoredUntil=ayer + anteayer (sin attempt ayer) → racha de 3
    dbMocks.user.findUnique.mockResolvedValue({
      lastStreakBonusAt:    null,
      streakRestoredUntil:  yesterdayMid,
    })
    dbMocks.examAttempt.findMany.mockResolvedValue([
      { startedAt: new Date(now - 60_000) },                    // hoy
      { startedAt: new Date(now - 2 * 86_400_000 - 60_000) },   // anteayer
    ])
    dbMocks.user.update.mockImplementation(async (args: { data: { xp?: unknown; lastStreakBonusAt?: unknown } }) => {
      if (args.data.xp) return { xp: 20 }
      return { lastStreakBonusAt: new Date() }
    })

    const r = await awardDailyStreakBonusIfDue(1)
    expect(r).not.toBeNull()
    // Día 3 del ciclo → +20 XP
    const xpCall = dbMocks.user.update.mock.calls.find(
      ([args]) => "xp" in (args as { data: object }).data,
    )
    expect(xpCall?.[0]).toMatchObject({ data: { xp: { increment: 20 } } })
  })
})

// ────────────────────────────────────────────────────────────────────────
// Escenario end-to-end del endpoint POST /api/attempts
// ────────────────────────────────────────────────────────────────────────
describe("Endpoint flow: examen real first-of-day → awarded = base + bonus", () => {
  it("primer examen real del día con 1 error → awarded = 14 (base) + 10 (D1 bonus) = 24", async () => {
    // Caso que reportó el usuario: hace un examen real con 1 error y
    // espera ver en la animación +19 (no +14). Confirmamos que el flujo
    // del endpoint (awardXp para base + awardDailyStreakBonusIfDue para
    // el bonus) realmente devuelve la suma combinada al cliente.

    // Estado inicial del usuario en BBDD (simulado).
    let currentXp = 5
    let currentLastBonusAt: Date | null = null

    // Mock de findUnique: devuelve flags o xp según qué pida el caller.
    dbMocks.user.findUnique.mockImplementation(async (args: {
      where: { id: number }
      select: { xp?: boolean; lastStreakBonusAt?: boolean; streakRestoredUntil?: boolean }
    }) => {
      if (args.select.lastStreakBonusAt) {
        return { lastStreakBonusAt: currentLastBonusAt, streakRestoredUntil: null }
      }
      if (args.select.xp) {
        return { xp: currentXp }
      }
      return null
    })

    // Mock de findMany: el examen recién creado es el único de hoy.
    // Sin nada en yesterday → chain length = 1 → bonus D1 = 10.
    dbMocks.examAttempt.findMany.mockResolvedValue([
      { startedAt: new Date() },
    ])

    // Mock de update: distingue entre update de xp y de lastStreakBonusAt
    // y mantiene el estado simulado coherente.
    dbMocks.user.update.mockImplementation(async (args: {
      where: { id: number }
      data: { xp?: { increment: number }; lastStreakBonusAt?: Date }
    }) => {
      if (args.data.xp) {
        currentXp += args.data.xp.increment
        return { xp: currentXp }
      }
      if (args.data.lastStreakBonusAt) {
        currentLastBonusAt = args.data.lastStreakBonusAt
        return { lastStreakBonusAt: currentLastBonusAt }
      }
      return {}
    })

    // ── Replica el flujo del endpoint POST /api/attempts ──
    // 1. computeExamXp con score=29/total=30 → 1 error → 14 base
    // (Importado por nombre — si fallara, el test no compila.)
    const { computeExamXp, sumXp } = await import("./xp")
    const breakdown = computeExamXp({ score: 29, total: 30 })
    expect(sumXp(breakdown)).toBe(14)

    // 2. awardXp con la base
    const xpResult = await awardXp(1, 14, "exam-finish")
    expect(xpResult.oldXp).toBe(5)
    expect(xpResult.newXp).toBe(19)

    // 3. awardDailyStreakBonusIfDue para el bonus diario
    const streakResult = await awardDailyStreakBonusIfDue(1)
    expect(streakResult).not.toBeNull()
    expect(streakResult!.oldXp).toBe(19)
    expect(streakResult!.newXp).toBe(29)

    // 4. Calcular awarded como hace el endpoint: finalState.newXp - xpResult.oldXp
    const finalState = streakResult ?? xpResult
    const awarded = finalState.newXp - xpResult.oldXp
    expect(awarded).toBe(24)

    // 5. Verificar que el state simulado quedó consistente
    expect(currentXp).toBe(29)
    expect(currentLastBonusAt).not.toBeNull()
  })

  it("examen real cuando bonus ya cobrado hoy → awarded = solo base (sin bonus duplicado)", async () => {
    // Si el bonus ya se pagó hoy (claimedToday=true), awardDailyStreakBonusIfDue
    // devuelve null y awarded incluye solo la base. Idempotencia del bonus.
    let currentXp = 10
    const today8am = new Date()
    today8am.setHours(8, 0, 0, 0)

    dbMocks.user.findUnique.mockImplementation(async (args: {
      select: { lastStreakBonusAt?: boolean }
    }) => {
      if (args.select.lastStreakBonusAt) {
        return { lastStreakBonusAt: today8am, streakRestoredUntil: null }
      }
      return null
    })
    dbMocks.examAttempt.findMany.mockResolvedValue([{ startedAt: new Date() }])
    dbMocks.user.update.mockImplementation(async (args: {
      data: { xp?: { increment: number } }
    }) => {
      if (args.data.xp) {
        currentXp += args.data.xp.increment
        return { xp: currentXp }
      }
      return {}
    })

    const xpResult = await awardXp(1, 14, "exam-finish")
    expect(xpResult.newXp).toBe(24)

    const streakResult = await awardDailyStreakBonusIfDue(1)
    expect(streakResult).toBeNull() // ya cobrado hoy

    const finalState = streakResult ?? xpResult
    const awarded = finalState.newXp - xpResult.oldXp
    expect(awarded).toBe(14) // solo base, sin bonus duplicado
  })
})
