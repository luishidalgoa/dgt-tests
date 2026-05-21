/**
 * Aplica una migración SQL a Turso.
 *
 *   npm run turso:apply-migration -- <nombre-de-la-carpeta-en-prisma/migrations>
 *
 * Ejemplo:
 *   npm run turso:apply-migration -- 20260521160000_add_user_ai_paid
 *
 * Lee `prisma/migrations/<name>/migration.sql`, lo ejecuta sentencia a
 * sentencia contra Turso, y deja constancia en la tabla
 * `_migrations_applied` (igual que turso-mark-applied.ts).
 *
 * Idempotente: si la migración ya está en `_migrations_applied`, se
 * salta sin tocar nada.
 *
 * NOTA: este script NO hace lo mismo que `prisma migrate deploy` —
 * Prisma CLI no soporta Turso/libsql nativamente, por eso aplicamos
 * a mano. El schema.prisma sigue siendo la fuente de verdad para el
 * cliente TypeScript.
 */
import { createClient } from "@libsql/client"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

async function main() {
  const name = process.argv[2]
  if (!name) {
    console.error("Uso: turso-apply-migration.ts <nombre-de-la-migracion>")
    console.error("Ej:  turso-apply-migration.ts 20260521160000_add_user_ai_paid")
    process.exit(1)
  }
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("✗ TURSO_DATABASE_URL no definida")
    process.exit(1)
  }

  const c = createClient({
    url:       process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  console.log(`📥 Target: ${process.env.TURSO_DATABASE_URL}`)
  console.log(`📦 Migración: ${name}`)
  console.log()

  // Asegurar que existe el tracker de migraciones
  await c.execute(`CREATE TABLE IF NOT EXISTS _migrations_applied (name TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)`)

  // ¿Ya aplicada?
  const existing = await c.execute({
    sql: "SELECT name FROM _migrations_applied WHERE name = ?",
    args: [name],
  })
  if (existing.rows.length > 0) {
    console.log(`✓ '${name}' ya está marcada como aplicada en Turso — no hago nada.`)
    c.close()
    return
  }

  // Leer el .sql
  const path = resolve(process.cwd(), "prisma", "migrations", name, "migration.sql")
  let sql: string
  try {
    sql = await readFile(path, "utf-8")
  } catch (err) {
    console.error(`✗ No pude leer ${path}:`, err instanceof Error ? err.message : err)
    process.exit(1)
  }

  // Quitar líneas de comentario `-- ...` antes de partir por `;`, porque
  // si una sentencia va precedida de comentarios el filtro startsWith
  // ("--") la descartaría entera.
  const stripped = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")

  // Partir por `;` (al final de sentencia). Funciona para migraciones
  // generadas por Prisma y las nuestras manuales que no usan triggers /
  // procedimientos con `;` intercalados.
  const statements = stripped
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  console.log(`→ ${statements.length} sentencia(s) a ejecutar.`)
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]
    const preview = stmt.replace(/\s+/g, " ").slice(0, 90)
    console.log(`   [${i + 1}/${statements.length}] ${preview}${stmt.length > 90 ? "..." : ""}`)
    try {
      await c.execute(stmt)
    } catch (err) {
      console.error(`✗ Falló esta sentencia. Aborto sin marcar como aplicada.`)
      console.error(err instanceof Error ? err.message : err)
      c.close()
      process.exit(1)
    }
  }

  // Marcar como aplicada
  await c.execute({
    sql: "INSERT INTO _migrations_applied (name) VALUES (?)",
    args: [name],
  })
  console.log(`\n✅ '${name}' aplicada y registrada en Turso.`)

  c.close()
}

main().catch((e) => {
  console.error("❌", e)
  process.exit(1)
})
