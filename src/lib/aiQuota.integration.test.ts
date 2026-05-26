import { describe, it, expect, vi, beforeEach } from "vitest"

const dbMocks = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update:     vi.fn(),
  },
  appConfig: {
    findUnique: vi.fn(),
  },
}))

vi.mock("@/lib/db", () => ({ db: dbMocks }))

import { getQuotaStatus, consumeToken } from "./aiQuota"

// Fecha de renovación en el futuro (no debe disparar reset durante los tests)
const FUTURE_RENEWAL = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
const proUser = {
  aiTokensUsed:                 0,
  aiTokensMonth:                new Date().toISOString().slice(0, 7),  // legacy, no usado por la nueva lógica
  aiTokensRenewalAt:            FUTURE_RENEWAL,
  role:                         "SUBSCRIBER",
  subscriptionStatus:           "active",
  subscriptionCurrentPeriodEnd: FUTURE_RENEWAL,
  createdAt:                    new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
}
const freeUser = {
  aiTokensUsed:                 0,
  aiTokensMonth:                new Date().toISOString().slice(0, 7),
  aiTokensRenewalAt:            FUTURE_RENEWAL,
  role:                         "USER",
  subscriptionStatus:           null,
  subscriptionCurrentPeriodEnd: null,
  createdAt:                    new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
}

describe("aiQuota — integración con AppConfig (Fase 92)", () => {
  beforeEach(() => {
    dbMocks.user.findUnique.mockReset()
    dbMocks.user.update.mockReset()
    dbMocks.appConfig.findUnique.mockReset()
  })

  it("getQuotaStatus PRO usa el default 60 si AppConfig no tiene override", async () => {
    dbMocks.user.findUnique.mockResolvedValue(proUser)
    dbMocks.appConfig.findUnique.mockResolvedValue(null)  // no hay override
    const status = await getQuotaStatus(1)
    expect(status.max).toBe(60)
  })

  it("getQuotaStatus PRO lee el override de AppConfig (p.ej. promo a 100)", async () => {
    dbMocks.user.findUnique.mockResolvedValue(proUser)
    dbMocks.appConfig.findUnique.mockImplementation((async (args: { where: { key: string } }) => {
      if (args.where.key === "AI_TOKENS_PRO") {
        return { key: "AI_TOKENS_PRO", value: "100", encrypted: false, updatedAt: new Date(), updatedBy: 1 }
      }
      return null
    }) as never)
    const status = await getQuotaStatus(1)
    expect(status.max).toBe(100)
    expect(status.remaining).toBe(100)
  })

  it("getQuotaStatus FREE usa el default 10 si AppConfig no tiene override", async () => {
    dbMocks.user.findUnique.mockResolvedValue(freeUser)
    dbMocks.appConfig.findUnique.mockResolvedValue(null)
    const status = await getQuotaStatus(2)
    expect(status.max).toBe(10)
  })

  it("getQuotaStatus FREE lee override (p.ej. 20)", async () => {
    dbMocks.user.findUnique.mockResolvedValue(freeUser)
    dbMocks.appConfig.findUnique.mockImplementation((async (args: { where: { key: string } }) => {
      if (args.where.key === "AI_TOKENS_FREE") {
        return { key: "AI_TOKENS_FREE", value: "20", encrypted: false, updatedAt: new Date(), updatedBy: 1 }
      }
      return null
    }) as never)
    const status = await getQuotaStatus(2)
    expect(status.max).toBe(20)
  })

  it("consumeToken también respeta el override del catálogo", async () => {
    dbMocks.user.findUnique.mockResolvedValue(proUser)
    dbMocks.user.update.mockResolvedValue({ ...proUser, aiTokensUsed: 1 })
    dbMocks.appConfig.findUnique.mockImplementation((async (args: { where: { key: string } }) => {
      if (args.where.key === "AI_TOKENS_PRO") {
        return { key: "AI_TOKENS_PRO", value: "90", encrypted: false, updatedAt: new Date(), updatedBy: 1 }
      }
      return null
    }) as never)
    const status = await consumeToken(1)
    expect(status?.max).toBe(90)
    expect(status?.remaining).toBe(89)
  })
})
