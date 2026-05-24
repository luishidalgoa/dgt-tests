/**
 * Tests de integración para `restoreStreakAction` — la server action
 * que decrementa el crédito y marca `streakRestoredUntil`.
 *
 * Cubre lo que streak.test.ts no toca: el WRITE atómico contra BBDD,
 * los guardrails de auth + eligibilidad, y la protección anti-doble-click
 * vía updateMany condicional.
 *
 * Patrón: mismo que `aiQuota.integration.test.ts` — `vi.hoisted` con
 * mocks de db, getCurrentUser, revalidatePath.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const dbMocks = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  examAttempt: {
    findMany: vi.fn(),
  },
}))

const authMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
}))

vi.mock("@/lib/db", () => ({ db: dbMocks }))
vi.mock("@/lib/auth", () => ({ getCurrentUser: authMocks.getCurrentUser }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { restoreStreakAction } from "./streak"

/** Construye un user mock con valores por defecto razonables. */
function mkUser(overrides: {
  id?: number
  streakRestoreCredits?: number
  streakRestoredUntil?: Date | null
} = {}) {
  return {
    id:                   overrides.id ?? 1,
    username:             "luishidalgoa",
    streakRestoreCredits: overrides.streakRestoreCredits ?? 1,
    streakRestoredUntil:  overrides.streakRestoredUntil ?? null,
  }
}

/** Construye attempts en deltas de días desde hoy.
 *  -1 = ayer, -2 = anteayer, ... */
function attemptsAt(...deltas: number[]): { startedAt: Date }[] {
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  return deltas.map((d) => {
    const dt = new Date(today)
    dt.setDate(dt.getDate() + d)
    return { startedAt: dt }
  })
}

beforeEach(() => {
  dbMocks.user.findUnique.mockReset()
  dbMocks.user.updateMany.mockReset()
  dbMocks.examAttempt.findMany.mockReset()
  authMocks.getCurrentUser.mockReset()
})

describe("restoreStreakAction — auth + créditos", () => {
  it("rechaza si no hay user autenticado", async () => {
    authMocks.getCurrentUser.mockResolvedValue(null)
    const res = await restoreStreakAction()
    expect(res).toEqual({ ok: false, error: "No autenticado" })
    expect(dbMocks.user.updateMany).not.toHaveBeenCalled()
  })

  it("rechaza si streakRestoreCredits = 0 (sin escribir en BBDD)", async () => {
    authMocks.getCurrentUser.mockResolvedValue(mkUser({ streakRestoreCredits: 0 }))
    const res = await restoreStreakAction()
    expect(res).toEqual({
      ok: false,
      error: "No te quedan créditos de restauración",
    })
    expect(dbMocks.user.updateMany).not.toHaveBeenCalled()
    expect(dbMocks.examAttempt.findMany).not.toHaveBeenCalled()
  })
})

describe("restoreStreakAction — eligibilidad (canRestore=false)", () => {
  it("rechaza si ayer ya tiene examen real (no hay rotura)", async () => {
    authMocks.getCurrentUser.mockResolvedValue(mkUser({ streakRestoreCredits: 2 }))
    // Ayer SÍ tiene attempt → yesterdayBroken=false → canRestore=false
    dbMocks.examAttempt.findMany.mockResolvedValue(attemptsAt(-1, -2))
    const res = await restoreStreakAction()
    expect(res).toEqual({
      ok: false,
      error: "La racha no se puede restaurar ahora mismo",
    })
    expect(dbMocks.user.updateMany).not.toHaveBeenCalled()
  })

  it("rechaza si anteayer también está vacío (rotura de 2+ días)", async () => {
    authMocks.getCurrentUser.mockResolvedValue(mkUser({ streakRestoreCredits: 2 }))
    // Solo hace 3 días: ni ayer ni anteayer → anteayerHadReal=false
    dbMocks.examAttempt.findMany.mockResolvedValue(attemptsAt(-3))
    const res = await restoreStreakAction()
    expect(res).toEqual({
      ok: false,
      error: "La racha no se puede restaurar ahora mismo",
    })
    expect(dbMocks.user.updateMany).not.toHaveBeenCalled()
  })

  it("rechaza si streakRestoredUntil ya es ayer (no se puede re-restaurar)", async () => {
    const yesterday = new Date()
    yesterday.setHours(0, 0, 0, 0)
    yesterday.setDate(yesterday.getDate() - 1)
    authMocks.getCurrentUser.mockResolvedValue(
      mkUser({ streakRestoreCredits: 2, streakRestoredUntil: yesterday }),
    )
    dbMocks.examAttempt.findMany.mockResolvedValue(attemptsAt(-2))
    const res = await restoreStreakAction()
    expect(res).toEqual({
      ok: false,
      error: "La racha no se puede restaurar ahora mismo",
    })
    expect(dbMocks.user.updateMany).not.toHaveBeenCalled()
  })
})

describe("restoreStreakAction — happy path (decrementa crédito)", () => {
  it("eligible → updateMany con decrement + restoredUntil=ayer, devuelve remainingCredits", async () => {
    authMocks.getCurrentUser.mockResolvedValue(mkUser({ streakRestoreCredits: 3 }))
    // Anteayer real, ayer vacío → eligible
    dbMocks.examAttempt.findMany.mockResolvedValue(attemptsAt(-2, -3))
    dbMocks.user.updateMany.mockResolvedValue({ count: 1 })

    const res = await restoreStreakAction()
    expect(res).toEqual({ ok: true, remainingCredits: 2 })

    // Verifica el shape del UPDATE: condicional + decremento + fecha
    expect(dbMocks.user.updateMany).toHaveBeenCalledTimes(1)
    const args = dbMocks.user.updateMany.mock.calls[0]?.[0] as {
      where: {
        id: number
        streakRestoreCredits: { gte: number }
        OR: unknown[]
      }
      data: {
        streakRestoreCredits: { decrement: number }
        streakRestoredUntil: Date
      }
    }
    expect(args.where.id).toBe(1)
    expect(args.where.streakRestoreCredits).toEqual({ gte: 1 })
    expect(args.data.streakRestoreCredits).toEqual({ decrement: 1 })

    // streakRestoredUntil debe ser MEDIANOCHE de ayer
    const yesterday = new Date()
    yesterday.setHours(0, 0, 0, 0)
    yesterday.setDate(yesterday.getDate() - 1)
    expect((args.data.streakRestoredUntil as Date).getTime()).toBe(
      yesterday.getTime(),
    )
  })

  it("con 1 solo crédito → remainingCredits=0 tras gastar", async () => {
    authMocks.getCurrentUser.mockResolvedValue(mkUser({ streakRestoreCredits: 1 }))
    dbMocks.examAttempt.findMany.mockResolvedValue(attemptsAt(-2))
    dbMocks.user.updateMany.mockResolvedValue({ count: 1 })

    const res = await restoreStreakAction()
    expect(res).toEqual({ ok: true, remainingCredits: 0 })
  })
})

describe("restoreStreakAction — protección anti-race (doble click)", () => {
  it("si updateMany devuelve count=0 (alguien gastó antes) → error, no toca créditos", async () => {
    // Escenario: la app pasó las validaciones pero entre que decidimos
    // y ejecutamos el UPDATE, otra petición ya consumió el crédito.
    // El where condicional `streakRestoreCredits >= 1` AND restoredUntil
    // != yesterday falla → count=0.
    authMocks.getCurrentUser.mockResolvedValue(mkUser({ streakRestoreCredits: 2 }))
    dbMocks.examAttempt.findMany.mockResolvedValue(attemptsAt(-2))
    dbMocks.user.updateMany.mockResolvedValue({ count: 0 })

    const res = await restoreStreakAction()
    expect(res).toEqual({
      ok: false,
      error: "La racha ya estaba restaurada",
    })
  })
})
