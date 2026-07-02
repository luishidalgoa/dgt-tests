import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/db", () => ({
  db: { appConfig: { findUnique: vi.fn() } },
}))

import {
  CONFIG_CATALOG,
  getAITokensFree,
  getAITokensPro,
  getFreeTestLimit,
  isMaintenanceMode,
  isFeatureEnabled,
  getWelcomeMessage,
  getMailFrom,
  getSmtpHost,
  getSmtpPort,
  getSmtpUser,
} from "./configCatalog"
import { db } from "@/lib/db"

const TEST_KEY = Buffer.alloc(32, 7).toString("base64")

describe("CONFIG_CATALOG", () => {
  it("define al menos las 8 keys esperadas", () => {
    const keys = CONFIG_CATALOG.map(c => c.key)
    expect(keys).toContain("AI_TOKENS_FREE")
    expect(keys).toContain("AI_TOKENS_PRO")
    expect(keys).toContain("FREE_TEST_LIMIT")
    expect(keys).toContain("MAINTENANCE_MODE")
    expect(keys).toContain("FEATURE_COMPETIR")
    expect(keys).toContain("FEATURE_AI")
    expect(keys).toContain("FEATURE_REGISTRATION")
    expect(keys).toContain("WELCOME_MESSAGE")
  })

  it("cada entrada tiene type, default, label y category", () => {
    for (const entry of CONFIG_CATALOG) {
      expect(entry.type).toMatch(/^(number|boolean|string)$/)
      expect(entry.default).toBeDefined()
      expect(entry.label).toBeTruthy()
      expect(entry.category).toMatch(/^(quotas|features|messages|integrations)$/)
    }
  })
})

describe("getters tipados — devuelven default si no hay valor en DB", () => {
  beforeEach(() => {
    process.env.APP_MASTER_KEY = TEST_KEY
    vi.mocked(db.appConfig.findUnique).mockReset()
    vi.mocked(db.appConfig.findUnique).mockResolvedValue(null)
  })
  afterEach(() => { delete process.env.APP_MASTER_KEY })

  it("getAITokensFree default = 10", async () => {
    expect(await getAITokensFree()).toBe(10)
  })

  it("getAITokensPro default = 60", async () => {
    expect(await getAITokensPro()).toBe(60)
  })

  it("getFreeTestLimit default = 7", async () => {
    expect(await getFreeTestLimit()).toBe(7)
  })

  it("isMaintenanceMode default = false", async () => {
    expect(await isMaintenanceMode()).toBe(false)
  })

  it("isFeatureEnabled('competir') default = true", async () => {
    expect(await isFeatureEnabled("competir")).toBe(true)
  })

  it("isFeatureEnabled('ai') default = true", async () => {
    expect(await isFeatureEnabled("ai")).toBe(true)
  })

  it("isFeatureEnabled('registration') default = true", async () => {
    expect(await isFeatureEnabled("registration")).toBe(true)
  })

  it("isFeatureEnabled de key desconocida → false (defensivo)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await isFeatureEnabled("inventada" as any)).toBe(false)
  })

  it("getWelcomeMessage devuelve string default no vacío", async () => {
    const msg = await getWelcomeMessage()
    expect(typeof msg).toBe("string")
    expect(msg.length).toBeGreaterThan(0)
  })
})

describe("getters tipados — leen el valor de BBDD si existe", () => {
  beforeEach(() => {
    process.env.APP_MASTER_KEY = TEST_KEY
    vi.mocked(db.appConfig.findUnique).mockReset()
  })
  afterEach(() => { delete process.env.APP_MASTER_KEY })

  it("getAITokensPro lee 100 si está en DB", async () => {
    vi.mocked(db.appConfig.findUnique).mockResolvedValue({
      key: "AI_TOKENS_PRO", value: "100", encrypted: false, updatedAt: new Date(), updatedBy: null,
    } as never)
    expect(await getAITokensPro()).toBe(100)
  })

  it("isMaintenanceMode devuelve true si DB lo dice", async () => {
    vi.mocked(db.appConfig.findUnique).mockResolvedValue({
      key: "MAINTENANCE_MODE", value: "true", encrypted: false, updatedAt: new Date(), updatedBy: null,
    } as never)
    expect(await isMaintenanceMode()).toBe(true)
  })

  it("isFeatureEnabled('competir') devuelve false si DB lo desactiva", async () => {
    vi.mocked(db.appConfig.findUnique).mockResolvedValue({
      key: "FEATURE_COMPETIR", value: "false", encrypted: false, updatedAt: new Date(), updatedBy: null,
    } as never)
    expect(await isFeatureEnabled("competir")).toBe(false)
  })
})

describe("getters SMTP — defaults Resend si no hay valor en DB ni env", () => {
  beforeEach(() => {
    vi.mocked(db.appConfig.findUnique).mockReset()
    vi.mocked(db.appConfig.findUnique).mockResolvedValue(null)
    delete process.env.MAIL_FROM
    delete process.env.SMTP_HOST
    delete process.env.SMTP_PORT
    delete process.env.SMTP_USER
  })

  it("getMailFrom default = 'DGT-TESTS <noreply@hdglabs.com>'", async () => {
    expect(await getMailFrom()).toBe("DGT-TESTS <noreply@hdglabs.com>")
  })
  it("getSmtpHost default = 'smtp.resend.com'", async () => {
    expect(await getSmtpHost()).toBe("smtp.resend.com")
  })
  it("getSmtpPort default = 465", async () => {
    expect(await getSmtpPort()).toBe(465)
  })
  it("getSmtpUser default = 'resend'", async () => {
    expect(await getSmtpUser()).toBe("resend")
  })

  it("getMailFrom lee el valor de BBDD si existe", async () => {
    vi.mocked(db.appConfig.findUnique).mockResolvedValue({
      key: "MAIL_FROM", value: JSON.stringify("Soporte <soporte@hdglabs.com>"),
      encrypted: false, updatedAt: new Date(), updatedBy: null,
    } as never)
    expect(await getMailFrom()).toBe("Soporte <soporte@hdglabs.com>")
  })
})
