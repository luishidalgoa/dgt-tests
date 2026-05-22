import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { encryptSecret, decryptSecret, generateMasterKey } from "./crypto"

/**
 * AES-256-GCM:
 *   - Confidencialidad (cifrado simétrico fuerte)
 *   - Integridad (auth tag — detecta manipulación)
 *   - IV único por mensaje (mismo plaintext + misma key → cipher distinto)
 *
 * Formato del envelope:  base64(iv) + ":" + base64(authTag) + ":" + base64(ciphertext)
 * Tres partes separadas por ":" para que cualquier libsql/SQLite lo trate como string.
 */

const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" // 64 hex = 32 bytes

describe("encryptSecret + decryptSecret", () => {
  beforeEach(() => {
    process.env.APP_MASTER_KEY = Buffer.from(TEST_KEY, "hex").toString("base64")
  })
  afterEach(() => {
    delete process.env.APP_MASTER_KEY
  })

  it("roundtrip funciona para un secret normal", () => {
    const env = encryptSecret("sk_live_supersecret123")
    expect(decryptSecret(env)).toBe("sk_live_supersecret123")
  })

  it("envelope NO contiene el plaintext en claro", () => {
    const env = encryptSecret("PASSWORD")
    expect(env).not.toContain("PASSWORD")
    expect(env).not.toContain("password")
  })

  it("formato del envelope es 'iv:authTag:ciphertext' en base64", () => {
    const env = encryptSecret("hi")
    const parts = env.split(":")
    expect(parts.length).toBe(3)
    // IV de AES-GCM = 12 bytes = 16 base64 chars; authTag = 16 bytes = 24 base64 chars
    expect(parts[0].length).toBeGreaterThanOrEqual(12)
    expect(parts[1].length).toBeGreaterThanOrEqual(20)
  })

  it("mismo plaintext + misma key → cipher distinto cada vez (IV random)", () => {
    const a = encryptSecret("repeat-me")
    const b = encryptSecret("repeat-me")
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe("repeat-me")
    expect(decryptSecret(b)).toBe("repeat-me")
  })

  it("decryptSecret tira si el envelope está manipulado (auth tag falla)", () => {
    const env = encryptSecret("secret")
    // Romper el ciphertext: cambiar un char del último segmento
    const parts = env.split(":")
    parts[2] = parts[2].slice(0, -2) + (parts[2].slice(-2) === "AA" ? "BB" : "AA")
    const tampered = parts.join(":")
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it("decryptSecret tira si el envelope no tiene formato válido", () => {
    expect(() => decryptSecret("not-an-envelope")).toThrow()
    expect(() => decryptSecret("only:two")).toThrow()
    expect(() => decryptSecret("")).toThrow()
  })

  it("decryptSecret tira si APP_MASTER_KEY está mal", () => {
    const env = encryptSecret("secret")
    // Cambiar la key
    process.env.APP_MASTER_KEY = Buffer.alloc(32, 1).toString("base64")
    expect(() => decryptSecret(env)).toThrow()
  })

  it("encryptSecret tira si APP_MASTER_KEY no está definida", () => {
    delete process.env.APP_MASTER_KEY
    expect(() => encryptSecret("secret")).toThrow(/APP_MASTER_KEY/)
  })

  it("encryptSecret tira si APP_MASTER_KEY no es 32 bytes", () => {
    process.env.APP_MASTER_KEY = Buffer.alloc(16).toString("base64") // solo 16 bytes
    expect(() => encryptSecret("secret")).toThrow(/32 bytes/)
  })

  it("soporta plaintext con UTF-8 (emojis, acentos)", () => {
    const text = "Ñam ñam 🍕 секрет"
    expect(decryptSecret(encryptSecret(text))).toBe(text)
  })

  it("soporta plaintext vacío", () => {
    expect(decryptSecret(encryptSecret(""))).toBe("")
  })
})

describe("generateMasterKey", () => {
  it("devuelve una key base64 de 32 bytes", () => {
    const key = generateMasterKey()
    const buf = Buffer.from(key, "base64")
    expect(buf.length).toBe(32)
  })

  it("genera keys distintas cada vez", () => {
    expect(generateMasterKey()).not.toBe(generateMasterKey())
  })
})
