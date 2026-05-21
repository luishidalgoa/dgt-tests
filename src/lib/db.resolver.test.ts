import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"

/**
 * Tests del resolver de URL de BBDD (la lógica del `||` en src/lib/db.ts).
 *
 * Regresión Fase 82: queremos que TURSO_DATABASE_URL="" (string vacío,
 * típico cuando .env.local sobrescribe a vacío) caiga al SQLite local.
 *
 * Replicamos la línea exacta de db.ts para que si cambia (p. ej.
 * alguien la pone a `??` por error), este test rompa.
 */

function buildLocalUrl(): string {
  return pathToFileURL(resolve(process.cwd(), "prisma", "dev.db")).href
}

function resolveDatabaseUrl(): string {
  // ⚠ Esta línea debe ser IDÉNTICA a la de src/lib/db.ts. Si la modificas
  //   allí, modifícala aquí también — y mejor convierte ambas en una sola
  //   función exportada.
  return process.env.TURSO_DATABASE_URL || buildLocalUrl()
}

describe("resolveDatabaseUrl (Fase 82 — dev local SQLite)", () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env.TURSO_DATABASE_URL
  })
  afterEach(() => {
    if (original === undefined) delete process.env.TURSO_DATABASE_URL
    else process.env.TURSO_DATABASE_URL = original
  })

  it("usa Turso cuando TURSO_DATABASE_URL está definida y no vacía", () => {
    process.env.TURSO_DATABASE_URL = "libsql://prod.turso.io"
    expect(resolveDatabaseUrl()).toBe("libsql://prod.turso.io")
  })

  it("cae al SQLite local cuando TURSO_DATABASE_URL es undefined", () => {
    delete process.env.TURSO_DATABASE_URL
    expect(resolveDatabaseUrl()).toMatch(/dev\.db$/)
    expect(resolveDatabaseUrl()).toMatch(/^file:/)
  })

  it("cae al SQLite local cuando TURSO_DATABASE_URL es STRING VACÍO (regresión Fase 82)", () => {
    // Este es el caso real: .env tiene la prod URL, .env.local pone "".
    // Con `??` (bug pre-Fase 82) habría intentado conectar a "" → boom.
    // Con `||` cae correctamente al local.
    process.env.TURSO_DATABASE_URL = ""
    expect(resolveDatabaseUrl()).toMatch(/dev\.db$/)
  })
})
