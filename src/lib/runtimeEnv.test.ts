import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { detectRuntimeEnv, detectStripeMode } from "./runtimeEnv"

describe("detectRuntimeEnv", () => {
  const original = { ...process.env }
  beforeEach(() => {
    // Reflect.deleteProperty para evitar el TS error de NODE_ENV "readonly"
    // que vienen en los types de Next.js
    Reflect.deleteProperty(process.env, "VERCEL")
    Reflect.deleteProperty(process.env, "VERCEL_ENV")
    Reflect.deleteProperty(process.env, "NODE_ENV")
  })
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in original)) Reflect.deleteProperty(process.env, k)
    }
    Object.assign(process.env, original)
  })

  it("Vercel + VERCEL_ENV=production → vercel-production", () => {
    process.env.VERCEL = "1"
    process.env.VERCEL_ENV = "production"
    const r = detectRuntimeEnv()
    expect(r.env).toBe("vercel-production")
    expect(r.label).toMatch(/vercel.*production/i)
    expect(r.isVercel).toBe(true)
    expect(r.isLocal).toBe(false)
  })

  it("Vercel + VERCEL_ENV=preview → vercel-preview", () => {
    process.env.VERCEL = "1"
    process.env.VERCEL_ENV = "preview"
    expect(detectRuntimeEnv().env).toBe("vercel-preview")
  })

  it("Vercel + VERCEL_ENV=development → vercel-development", () => {
    process.env.VERCEL = "1"
    process.env.VERCEL_ENV = "development"
    expect(detectRuntimeEnv().env).toBe("vercel-development")
  })

  it("VERCEL no set → local-dev (asumimos máquina local)", () => {
    const r = detectRuntimeEnv()
    expect(r.env).toBe("local-dev")
    expect(r.isLocal).toBe(true)
    expect(r.isVercel).toBe(false)
    expect(r.label).toMatch(/local/i)
  })

  it("label de local-dev menciona .env + .env.local", () => {
    const r = detectRuntimeEnv()
    expect(r.label).toMatch(/\.env/)
  })

  it("label de vercel-production menciona 'Environment Variables'", () => {
    process.env.VERCEL = "1"
    process.env.VERCEL_ENV = "production"
    const r = detectRuntimeEnv()
    expect(r.label).toMatch(/Environment Variables|env vars/i)
  })

  it("VERCEL='1' sin VERCEL_ENV → vercel-unknown (defensivo)", () => {
    process.env.VERCEL = "1"
    expect(detectRuntimeEnv().env).toBe("vercel-unknown")
  })
})

describe("detectStripeMode (por prefijo del valor)", () => {
  it("sk_live_* → live", () => {
    expect(detectStripeMode("sk_live_ABC123")).toBe("live")
  })

  it("rk_live_* (Restricted Key live) → live", () => {
    expect(detectStripeMode("rk_live_ABC123")).toBe("live")
  })

  it("sk_test_* → test", () => {
    expect(detectStripeMode("sk_test_ABC123")).toBe("test")
  })

  it("rk_test_* → test", () => {
    expect(detectStripeMode("rk_test_ABC123")).toBe("test")
  })

  it("whsec_* → unknown (no se puede saber del whsec si es live o test)", () => {
    expect(detectStripeMode("whsec_abc")).toBe("unknown")
  })

  it("price_test_* → test, price_live_* → live", () => {
    expect(detectStripeMode("price_test_abc")).toBe("test")
    expect(detectStripeMode("price_live_abc")).toBe("live")
  })

  it("null / vacío / sin prefijo conocido → unknown", () => {
    expect(detectStripeMode(null)).toBe("unknown")
    expect(detectStripeMode("")).toBe("unknown")
    expect(detectStripeMode("random_string")).toBe("unknown")
  })
})
