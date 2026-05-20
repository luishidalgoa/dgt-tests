/**
 * Copia los datos del SQLite local (prisma/dev.db) a Turso.
 *
 * Útil cuando ya tienes la BBDD local poblada y solo quieres replicarla
 * en Turso (sin re-correr el seed contra los JSONs originales).
 *
 * Uso:  npm run turso:sync
 */

import { createClient } from "@libsql/client"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const TABLES = [
  // Orden importante por las FKs
  "categories",
  "questions",
  "options",
  "tests",
  "test_questions",
  "exam_attempts",
  "answers",
  "manual_sections",
] as const

async function main() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("✗ TURSO_DATABASE_URL no está definida en .env")
    process.exit(1)
  }

  const localUrl = pathToFileURL(resolve(process.cwd(), "prisma", "dev.db")).href
  const source = createClient({ url: localUrl })
  const target = createClient({
    url:       process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  console.log(`📤 Source: ${localUrl}`)
  console.log(`📥 Target: ${process.env.TURSO_DATABASE_URL}\n`)

  let totalRows = 0

  for (const table of TABLES) {
    // Leer del source
    const { rows, columns } = await source.execute(`SELECT * FROM ${table}`)
    console.log(`  ${table.padEnd(20)} → ${rows.length} filas`)

    if (rows.length === 0) continue

    // Vaciar target por si tiene datos
    await target.execute(`DELETE FROM ${table}`)

    // Insertar en batches de 100
    const placeholders = "(" + columns.map(() => "?").join(",") + ")"
    const insertSql = `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(",")}) VALUES ${placeholders}`

    const batchSize = 50
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      await target.batch(
        batch.map((row) => ({
          sql:  insertSql,
          args: columns.map((c) => row[c]),
        })),
        "write"
      )
    }
    totalRows += rows.length
  }

  // Verificación
  console.log(`\n✅ Sincronización completa. Total filas: ${totalRows}`)
  console.log(`\nVerificación en Turso:`)
  for (const table of TABLES) {
    const r = await target.execute(`SELECT COUNT(*) as n FROM ${table}`)
    console.log(`  ${table.padEnd(20)} ${String(r.rows[0].n).padStart(6)} filas`)
  }

  source.close()
  target.close()
}

main().catch((e) => {
  console.error("❌ Error:", e)
  process.exit(1)
})
