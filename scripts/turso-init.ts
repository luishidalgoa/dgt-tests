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

  // Localizar migraciones
  const migrationsDir = resolve(process.cwd(), "prisma", "migrations")
  const dirs = readdirSync(migrationsDir)
    .filter((d) => statSync(join(migrationsDir, d)).isDirectory())
    .sort()

  console.log(`🔍 Migraciones encontradas: ${dirs.length}`)
  for (const d of dirs) console.log(`   - ${d}`)

  let totalStatements = 0

  for (const dir of dirs) {
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
