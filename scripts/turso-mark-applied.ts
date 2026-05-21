/**
 * Marca como aplicadas en Turso las migraciones que ya estaban antes de
 * introducir el tracker _migrations_applied. Solo necesario una vez.
 */
import { createClient } from "@libsql/client"

const c = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

async function main() {
  await c.execute(`CREATE TABLE IF NOT EXISTS _migrations_applied (name TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)`)

  const toMark = [
    "20260520190654_init",
    "20260520214753_add_manual_sections",
    "20260521062434_add_users",
  ]
  for (const name of toMark) {
    await c.execute({ sql: "INSERT OR IGNORE INTO _migrations_applied (name) VALUES (?)", args: [name] })
    console.log("✓", name)
  }

  const all = await c.execute("SELECT name FROM _migrations_applied ORDER BY name")
  console.log("\nAplicadas en Turso:")
  for (const r of all.rows) console.log("  -", r.name)

  c.close()
}

main().catch(console.error)
