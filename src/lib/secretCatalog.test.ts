import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/db", () => ({
  db: { appConfig: { findUnique: vi.fn() } },
}))

import {
  SECRET_CATALOG,
  getEffectiveSecret,
  maskSecret,
} from "./secretCatalog"
import { db } from "@/lib/db"
import { encryptSecret } from "./crypto"

const TEST_KEY = Buffer.alloc(32, 3).toString("base64")

describe("SECRET_CATALOG", () => {
  it("incluye las API keys principales del proyecto", () => {
    const keys = SECRET_CATALOG.map(s => s.key)
    expect(keys).toContain("STRIPE_SECRET_KEY")
    expect(keys).toContain("STRIPE_WEBHOOK_SECRET")
    expect(keys).toContain("GEMINI_API_KEY")
    expect(keys).toContain("GMAIL_APP_PASSWORD")
  })

  it("cada entrada tiene label + description + hint format opcional", () => {
    for (const s of SECRET_CATALOG) {
      expect(s.label).toBeTruthy()
      expect(s.description).toBeTruthy()
      expect(typeof s.key).toBe("string")
    }
  })
})

describe("maskSecret", () => {
  it("muestra los primeros chars + bullets para secrets largos", () => {
    // mask muestra primeros 8 chars + bullets — "FAKE_KEY" son 8 sin el "_"
    expect(maskSecret("FAKE_KEY_51TZW4YQXomb9iuOJverylong")).toMatch(/^FAKE_KEY/)
    expect(maskSecret("FAKE_KEY_51TZW4YQXomb9iuOJverylong")).toMatch(/•+$/)
  })

  it("para secrets cortos, oculta del todo", () => {
    expect(maskSecret("abc")).toBe("••••")
    expect(maskSecret("")).toBe("••••")
  })

  it("nunca devuelve el valor entero", () => {
    const s = "supersecretvalue123456789"
    expect(maskSecret(s)).not.toBe(s)
    expect(maskSecret(s).length).toBeLessThanOrEqual(s.length + 4) // no infla
  })
})

describe("getEffectiveSecret — DB cifrada gana, fallback a env", () => {
  beforeEach(() => {
    process.env.APP_MASTER_KEY = TEST_KEY
    vi.mocked(db.appConfig.findUnique).mockReset()
  })
  afterEach(() => {
    delete process.env.APP_MASTER_KEY
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.GEMINI_API_KEY
  })

  it("si DB tiene el secret cifrado, lo devuelve descifrado (gana sobre env)", async () => {
    process.env.STRIPE_SECRET_KEY = "FAKE_TEST_from_env"
    const envelope = encryptSecret("FAKE_KEY_from_db_winner")
    vi.mocked(db.appConfig.findUnique).mockResolvedValue({
      key: "STRIPE_SECRET_KEY", value: envelope, encrypted: true,
      updatedAt: new Date(), updatedBy: 1,
    } as never)
    expect(await getEffectiveSecret("STRIPE_SECRET_KEY")).toBe("FAKE_KEY_from_db_winner")
  })

  it("si DB no tiene el secret, cae al env var del mismo nombre", async () => {
    process.env.STRIPE_SECRET_KEY = "FAKE_TEST_from_env"
    vi.mocked(db.appConfig.findUnique).mockResolvedValue(null)
    expect(await getEffectiveSecret("STRIPE_SECRET_KEY")).toBe("FAKE_TEST_from_env")
  })

  it("si DB tiene un envelope corrupto, cae al env (defensivo, no rompe)", async () => {
    process.env.STRIPE_SECRET_KEY = "FAKE_TEST_from_env"
    vi.mocked(db.appConfig.findUnique).mockResolvedValue({
      key: "STRIPE_SECRET_KEY", value: "garbage", encrypted: true,
      updatedAt: new Date(), updatedBy: 1,
    } as never)
    expect(await getEffectiveSecret("STRIPE_SECRET_KEY")).toBe("FAKE_TEST_from_env")
  })

  it("si DB tiene una entrada NO encriptada (rara), la ignora y cae a env", async () => {
    process.env.STRIPE_SECRET_KEY = "FAKE_TEST_from_env"
    vi.mocked(db.appConfig.findUnique).mockResolvedValue({
      key: "STRIPE_SECRET_KEY", value: "sk_should_be_encrypted", encrypted: false,
      updatedAt: new Date(), updatedBy: 1,
    } as never)
    expect(await getEffectiveSecret("STRIPE_SECRET_KEY")).toBe("FAKE_TEST_from_env")
  })

  it("si ni DB ni env tienen el valor, devuelve null", async () => {
    delete process.env.STRIPE_SECRET_KEY
    vi.mocked(db.appConfig.findUnique).mockResolvedValue(null)
    expect(await getEffectiveSecret("STRIPE_SECRET_KEY")).toBeNull()
  })

  it("funciona para distintas keys del catálogo", async () => {
    process.env.GEMINI_API_KEY = "FAKE_GEMINI_env_test"
    vi.mocked(db.appConfig.findUnique).mockResolvedValue(null)
    expect(await getEffectiveSecret("GEMINI_API_KEY")).toBe("FAKE_GEMINI_env_test")
  })
})
