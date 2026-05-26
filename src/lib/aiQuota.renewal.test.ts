import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Tests del comportamiento de renovación en `getQuotaStatus`:
 *   1. Backfill lazy: si aiTokensRenewalAt es null en BBDD (user pre-existente
 *      o registro antiguo) → primer acceso lo calcula y guarda.
 *   2. Reset on past renewal: si la fecha guardada ya pasó → reset contador
 *      a 0 + avanza fecha al siguiente aniversario futuro. Verifica db.update.
 *
 * Mockamos @/lib/db por completo — no se toca BBDD real.
 */

const dbMocks = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update:     vi.fn(),
  },
  appConfig: {
    findUnique: vi.fn(),  // configCatalog cae a defaults si no hay override
  },
}))

vi.mock("@/lib/db", () => ({ db: dbMocks }))

import { getQuotaStatus } from "./aiQuota"

describe("getQuotaStatus — backfill lazy de aiTokensRenewalAt", () => {
  beforeEach(() => {
    dbMocks.user.findUnique.mockReset()
    dbMocks.user.update.mockReset()
    dbMocks.appConfig.findUnique.mockReset()
    dbMocks.appConfig.findUnique.mockResolvedValue(null)  // sin override
  })

  it("user nuevo SIN aiTokensRenewalAt → al primer acceso, lo guarda en BBDD", async () => {
    // Usuario registrado hace 5 días, sin field calculado
    const createdAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    dbMocks.user.findUnique.mockResolvedValue({
      aiTokensUsed:                 0,
      aiTokensRenewalAt:            null,                 // lazy: aún no calculado
      role:                         "USER",
      subscriptionStatus:           null,
      subscriptionCurrentPeriodEnd: null,
      createdAt,
    })
    dbMocks.user.update.mockResolvedValue({})

    const status = await getQuotaStatus(1)

    // El status devuelve una fecha futura (createdAt + 1mes)
    expect(new Date(status.resetsAt).getTime()).toBeGreaterThan(Date.now())

    // Y se hizo UPDATE persistiendo el campo en BBDD
    expect(dbMocks.user.update).toHaveBeenCalledTimes(1)
    const updateArgs = dbMocks.user.update.mock.calls[0]![0] as {
      where: { id: number }
      data:  { aiTokensRenewalAt?: Date; aiTokensUsed?: number }
    }
    expect(updateArgs.where.id).toBe(1)
    expect(updateArgs.data.aiTokensRenewalAt).toBeInstanceOf(Date)
    // No debe resetear el contador en el backfill (la fecha es futura)
    expect(updateArgs.data.aiTokensUsed).toBeUndefined()
  })

  it("user con aiTokensRenewalAt en el pasado → resetea contador + avanza fecha en BBDD", async () => {
    const pastRenewal = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const createdAt   = new Date(pastRenewal.getTime() - 60 * 24 * 60 * 60 * 1000)
    dbMocks.user.findUnique.mockResolvedValue({
      aiTokensUsed:                 8,                  // gastó 8 tokens
      aiTokensRenewalAt:            pastRenewal,
      role:                         "USER",
      subscriptionStatus:           null,
      subscriptionCurrentPeriodEnd: null,
      createdAt,
    })
    dbMocks.user.update.mockResolvedValue({})

    const status = await getQuotaStatus(2)

    // El status refleja contador reseteado
    expect(status.used).toBe(0)
    expect(status.remaining).toBe(status.max)
    // Y la fecha de reset es FUTURA
    expect(new Date(status.resetsAt).getTime()).toBeGreaterThan(Date.now())

    // BBDD: UPDATE con ambos cambios (reset + nueva fecha)
    expect(dbMocks.user.update).toHaveBeenCalledTimes(1)
    const data = dbMocks.user.update.mock.calls[0]![0].data as {
      aiTokensUsed:      number
      aiTokensRenewalAt: Date
    }
    expect(data.aiTokensUsed).toBe(0)
    expect(data.aiTokensRenewalAt).toBeInstanceOf(Date)
    expect(data.aiTokensRenewalAt.getTime()).toBeGreaterThan(Date.now())
  })

  it("user con aiTokensRenewalAt FUTURO → NO actualiza BBDD (no hay nada que hacer)", async () => {
    const futureRenewal = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
    dbMocks.user.findUnique.mockResolvedValue({
      aiTokensUsed:                 3,
      aiTokensRenewalAt:            futureRenewal,
      role:                         "USER",
      subscriptionStatus:           null,
      subscriptionCurrentPeriodEnd: null,
      createdAt:                    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    })

    const status = await getQuotaStatus(3)

    expect(status.used).toBe(3)
    expect(status.resetsAt).toBe(futureRenewal.toISOString())
    // No se ha tocado BBDD (no había nada que persistir)
    expect(dbMocks.user.update).not.toHaveBeenCalled()
  })

  it("user PRO con sub activa: aiTokensRenewalAt = subscriptionCurrentPeriodEnd", async () => {
    // PRO con sub que renueva en 10 días, sin field calculado aún
    const subEnd = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
    dbMocks.user.findUnique.mockResolvedValue({
      aiTokensUsed:                 0,
      aiTokensRenewalAt:            null,
      role:                         "SUBSCRIBER",
      subscriptionStatus:           "active",
      subscriptionCurrentPeriodEnd: subEnd,
      createdAt:                    new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    })
    dbMocks.user.update.mockResolvedValue({})

    const status = await getQuotaStatus(4)

    // resetsAt = subscriptionCurrentPeriodEnd
    expect(status.resetsAt).toBe(subEnd.toISOString())
    const data = dbMocks.user.update.mock.calls[0]![0].data as { aiTokensRenewalAt: Date }
    expect(data.aiTokensRenewalAt.toISOString()).toBe(subEnd.toISOString())
  })
})
