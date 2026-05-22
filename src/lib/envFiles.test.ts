import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { detectEnvFiles, getEnvFileForVar, ENV_FILE_PRECEDENCE } from "./envFiles"

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "dgt-envfiles-"))
})

afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe("ENV_FILE_PRECEDENCE", () => {
  it("respeta el orden que aplica Next.js (.env.local > .env)", () => {
    // En Next.js sin NODE_ENV custom, el orden es:
    // .env.development.local > .env.local > .env.development > .env
    expect(ENV_FILE_PRECEDENCE[0]).toBe(".env.development.local")
    expect(ENV_FILE_PRECEDENCE).toContain(".env.local")
    expect(ENV_FILE_PRECEDENCE).toContain(".env")
    // .env.local debe tener mayor prioridad que .env
    expect(ENV_FILE_PRECEDENCE.indexOf(".env.local"))
      .toBeLessThan(ENV_FILE_PRECEDENCE.indexOf(".env"))
  })
})

describe("detectEnvFiles", () => {
  it("devuelve los archivos que EXISTEN en el cwd dado, en orden", () => {
    writeFileSync(join(tmp, ".env"), "X=1")
    writeFileSync(join(tmp, ".env.local"), "X=2")
    const files = detectEnvFiles({ cwd: tmp })
    expect(files).toEqual([".env.local", ".env"])
  })

  it("ignora los que no existen", () => {
    writeFileSync(join(tmp, ".env"), "X=1")
    const files = detectEnvFiles({ cwd: tmp })
    expect(files).toEqual([".env"])
  })

  it("devuelve [] si no hay ningún .env", () => {
    expect(detectEnvFiles({ cwd: tmp })).toEqual([])
  })
})

describe("getEnvFileForVar", () => {
  it("encuentra la var en .env.local (mayor prioridad)", () => {
    writeFileSync(join(tmp, ".env"),       'GMAIL_USER="env_value"\n')
    writeFileSync(join(tmp, ".env.local"), 'GMAIL_USER="local_value"\n')
    expect(getEnvFileForVar("GMAIL_USER", { cwd: tmp })).toBe(".env.local")
  })

  it("encuentra la var en .env si NO está en .env.local", () => {
    writeFileSync(join(tmp, ".env"),       'STRIPE_SECRET_KEY="value"\n')
    writeFileSync(join(tmp, ".env.local"), "OTHER=x\n")
    expect(getEnvFileForVar("STRIPE_SECRET_KEY", { cwd: tmp })).toBe(".env")
  })

  it("devuelve null si la var no aparece en ningún archivo", () => {
    writeFileSync(join(tmp, ".env"), "FOO=1\n")
    expect(getEnvFileForVar("NONEXISTENT", { cwd: tmp })).toBeNull()
  })

  it("acepta líneas con/sin comillas y con espacios alrededor de '='", () => {
    writeFileSync(join(tmp, ".env"),
      'GMAIL_USER = "spaced"\n' +
      "NO_QUOTES=naked\n"
    )
    expect(getEnvFileForVar("GMAIL_USER", { cwd: tmp })).toBe(".env")
    expect(getEnvFileForVar("NO_QUOTES", { cwd: tmp })).toBe(".env")
  })

  it("ignora líneas de comentario (#) y vacías", () => {
    writeFileSync(join(tmp, ".env"),
      "# GMAIL_USER=comentado\n" +
      "\n" +
      "GMAIL_USER=real\n"
    )
    expect(getEnvFileForVar("GMAIL_USER", { cwd: tmp })).toBe(".env")
  })

  it("no confunde nombre similar como prefijo (GMAIL_USER vs GMAIL_USER_X)", () => {
    writeFileSync(join(tmp, ".env"), "GMAIL_USER_X=trampa\n")
    expect(getEnvFileForVar("GMAIL_USER", { cwd: tmp })).toBeNull()
  })

  it("devuelve null si no hay ningún archivo .env", () => {
    expect(getEnvFileForVar("ANY", { cwd: tmp })).toBeNull()
  })
})
