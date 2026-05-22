import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Mock de @/lib/db ANTES de importar appConfig
vi.mock("@/lib/db", () => ({
  db: {
    appConfig: {
      findUnique: vi.fn(),
      upsert:     vi.fn(),
      findMany:   vi.fn(),
    },
  },
}))

import { getConfig, setConfig, getSecretConfig, setSecretConfig, listAllConfig } from "./appConfig"
import { db } from "@/lib/db"

const TEST_KEY = Buffer.alloc(32, 7).toString("base64")

describe("appConfig — non-secret (plain JSON)", () => {
  beforeEach(() => {
    process.env.APP_MASTER_KEY = TEST_KEY
    vi.mocked(db.appConfig.findUnique).mockReset()
    vi.mocked(db.appConfig.upsert).mockReset()
  })
  afterEach(() => { delete process.env.APP_MASTER_KEY })

  it("getConfig devuelve el default si la key no existe", async () => {
    vi.mocked(db.appConfig.findUnique).mockResolvedValue(null)
    expect(await getConfig("AI_TOKENS_PRO", 60)).toBe(60)
    expect(await getConfig("SOME_FLAG", true)).toBe(true)
    expect(await getConfig("MSG", "default")).toBe("default")
  })

  it("getConfig parsea el JSON guardado y devuelve el valor tipado", async () => {
    vi.mocked(db.appConfig.findUnique).mockResolvedValue({
      key: "AI_TOKENS_PRO", value: "120", encrypted: false, updatedAt: new Date(), updatedBy: null,
    } as never)
    expect(await getConfig("AI_TOKENS_PRO", 60)).toBe(120)
  })

  it("getConfig: si la BBDD tiene JSON corrupto, devuelve el default", async () => {
    vi.mocked(db.appConfig.findUnique).mockResolvedValue({
      key: "X", value: "not json {{{", encrypted: false, updatedAt: new Date(), updatedBy: null,
    } as never)
    expect(await getConfig("X", "fallback")).toBe("fallback")
  })

  it("setConfig hace upsert con JSON.stringify y encrypted=false", async () => {
    vi.mocked(db.appConfig.upsert).mockResolvedValue({} as never)
    await setConfig("AI_TOKENS_PRO", 90, { byUserId: 42 })
    expect(db.appConfig.upsert).toHaveBeenCalledWith({
      where: { key: "AI_TOKENS_PRO" },
      create: { key: "AI_TOKENS_PRO", value: "90", encrypted: false, updatedBy: 42 },
      update: {                       value: "90", encrypted: false, updatedBy: 42 },
    })
  })

  it("setConfig acepta strings/objects/booleans/arrays", async () => {
    vi.mocked(db.appConfig.upsert).mockResolvedValue({} as never)
    await setConfig("MSG",   "hola",            { byUserId: 1 })
    await setConfig("FLAG",  true,              { byUserId: 1 })
    await setConfig("LIST",  [1, 2, 3],         { byUserId: 1 })
    await setConfig("OBJ",   { a: 1, b: "x" },  { byUserId: 1 })

    const calls = vi.mocked(db.appConfig.upsert).mock.calls.map(c => (c[0] as { create: { value: string } }).create.value)
    expect(calls).toEqual(['"hola"', "true", "[1,2,3]", '{"a":1,"b":"x"}'])
  })
})

describe("appConfig — secret (cifrado AES-256-GCM)", () => {
  beforeEach(() => {
    process.env.APP_MASTER_KEY = TEST_KEY
    vi.mocked(db.appConfig.findUnique).mockReset()
    vi.mocked(db.appConfig.upsert).mockReset()
  })
  afterEach(() => { delete process.env.APP_MASTER_KEY })

  it("setSecretConfig cifra antes de guardar (value en BBDD ≠ plaintext)", async () => {
    vi.mocked(db.appConfig.upsert).mockResolvedValue({} as never)
    await setSecretConfig("STRIPE_SECRET_KEY", "sk_live_super_secret_42", { byUserId: 1 })
    const call = vi.mocked(db.appConfig.upsert).mock.calls[0]?.[0] as { create: { value: string; encrypted: boolean } }
    expect(call.create.encrypted).toBe(true)
    expect(call.create.value).not.toContain("sk_live_super_secret_42")
    expect(call.create.value.split(":").length).toBe(3)  // envelope iv:tag:ct
  })

  it("getSecretConfig descifra correctamente (roundtrip)", async () => {
    // Simulamos lo que setSecretConfig metería en BBDD
    vi.mocked(db.appConfig.upsert).mockResolvedValue({} as never)
    let storedEnvelope = ""
    vi.mocked(db.appConfig.upsert).mockImplementation((async (args: { create: { value: string } }) => {
      storedEnvelope = args.create.value
      return {} as never
    }) as never)
    await setSecretConfig("X", "my-secret-value", { byUserId: 1 })

    vi.mocked(db.appConfig.findUnique).mockResolvedValue({
      key: "X", value: storedEnvelope, encrypted: true, updatedAt: new Date(), updatedBy: 1,
    } as never)
    expect(await getSecretConfig("X")).toBe("my-secret-value")
  })

  it("getSecretConfig devuelve null si la key no existe", async () => {
    vi.mocked(db.appConfig.findUnique).mockResolvedValue(null)
    expect(await getSecretConfig("MISSING")).toBeNull()
  })

  it("getSecretConfig devuelve null (no tira) si el envelope es inválido", async () => {
    vi.mocked(db.appConfig.findUnique).mockResolvedValue({
      key: "X", value: "garbage", encrypted: true, updatedAt: new Date(), updatedBy: null,
    } as never)
    expect(await getSecretConfig("X")).toBeNull()
  })
})

describe("listAllConfig", () => {
  beforeEach(() => {
    process.env.APP_MASTER_KEY = TEST_KEY
    vi.mocked(db.appConfig.findMany).mockReset()
  })
  afterEach(() => { delete process.env.APP_MASTER_KEY })

  it("devuelve TODAS las configs pero NUNCA descifra los secrets", async () => {
    vi.mocked(db.appConfig.findMany).mockResolvedValue([
      { key: "AI_TOKENS_PRO",     value: "60",       encrypted: false, updatedAt: new Date(), updatedBy: 1 },
      { key: "STRIPE_SECRET_KEY", value: "abc:def:ghi", encrypted: true, updatedAt: new Date(), updatedBy: 1 },
    ] as never)
    const all = await listAllConfig()
    expect(all).toHaveLength(2)
    const stripe = all.find(c => c.key === "STRIPE_SECRET_KEY")!
    expect(stripe.encrypted).toBe(true)
    // ⚠ Crítico: no devuelve el valor descifrado
    expect(stripe.value).toBeUndefined()
    expect(stripe.hasValue).toBe(true)
    const tokens = all.find(c => c.key === "AI_TOKENS_PRO")!
    expect(tokens.encrypted).toBe(false)
    expect(tokens.value).toBe(60)
  })
})
