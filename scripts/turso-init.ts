/**
 * Aplica las migraciones de Prisma a una BBDD libSQL/Turso ejecutando
 * los .sql que vivien en prisma/migrations/.
 *
 * Uso: npm run turso:init
 */

import { createClient } from "@libsql/client"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN

  if (!url) {
    console.error("✗ TURSO_DATABASE_URL no está definida en .env")
    process.exit(1)
  }
  if (!url.startsWith("libsql://")) {
    console.error(`✗ TURSO_DATABASE_URL debe empezar por libsql://, recibido: ${url}`)
    process.exit(1)
  }

  console.log(`📡 Conectando a: ${url}`)
  const client = createClient({ url, authToken })

  // Crear tabla de tracking de migraciones aplicadas
  await client.execute(`
    CREATE TABLE IF NOT EXISTS _migrations_applied (
      name        TEXT PRIMARY KEY,
      applied_at  TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Localizar migraciones
  const migrationsDir = resolve(process.cwd(), "prisma", "migrations")
  const dirs = readdirSync(migrationsDir)
    .filter((d) => statSync(join(migrationsDir, d)).isDirectory())
    .sort()

  // Leer las ya aplicadas
  const appliedRes = await client.execute("SELECT name FROM _migrations_applied")
  const applied = new Set(appliedRes.rows.map((r) => String(r.name)))

  console.log(`🔍 Migraciones encontradas: ${dirs.length}`)
  console.log(`📋 Ya aplicadas: ${applied.size}`)
  for (const d of dirs) {
    const mark = applied.has(d) ? "✓" : "•"
    console.log(`   ${mark} ${d}`)
  }

  let totalStatements = 0

  for (const dir of dirs) {
    if (applied.has(dir)) continue   // skip ya aplicadas
    const sqlPath = join(migrationsDir, dir, "migration.sql")
    const sql = readFileSync(sqlPath, "utf-8")

    // Dividir por ; — las sentencias pueden empezar por un comentario
    // "-- CreateTable" seguido de la sentencia real. Solo descartamos las
    // que después de quitar comentarios queden vacías.
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => {
        if (s.length === 0) return false
        const withoutComments = s.replace(/^(--[^\n]*\n?)+/g, "").trim()
        return withoutComments.length > 0
      })

    console.log(`\n▶  ${dir}  (${statements.length} sentencias)`)
    for (const stmt of statements) {
      try {
        await client.execute(stmt)
        totalStatements++
      } catch (err) {
        // Ignorar errores de "ya existe" — la migración puede haberse aplicado parcialmente antes
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes("already exists")) {
          console.log(`   · skip (already exists): ${stmt.slice(0, 60)}...`)
        } else {
          console.error(`   ✗ ${stmt.slice(0, 80)}...`)
          throw err
        }
      }
    }

    // Marcar como aplicada
    await client.execute({
      sql:  "INSERT OR IGNORE INTO _migrations_applied (name) VALUES (?)",
      args: [dir],
    })
  }

  // Listar tablas para verificación
  const tables = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%'"
  )
  console.log(`\n✅ Esquema aplicado. Tablas en Turso (${tables.rows.length}):`)
  for (const row of tables.rows) console.log(`   - ${row.name}`)

  console.log(`\nTotal sentencias ejecutadas: ${totalStatements}`)
  client.close()
}

main().catch((e) => {
  console.error("❌ Error:", e)
  process.exit(1)
})
