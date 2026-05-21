import { createClient } from "@libsql/client"

const c = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

async function main() {
  console.log(`📡 ${process.env.TURSO_DATABASE_URL}\n`)

  const tables = await c.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%'"
  )
  console.log("Tablas:", tables.rows.map((r) => r.name).join(", "))

  const u = await c.execute("SELECT id, username, displayName FROM users")
  console.log("\nUsuarios en Turso:")
  for (const row of u.rows) console.log(`  ${row.id}: ${row.username} (${row.displayName})`)

  const counts: Record<string, number> = {}
  for (const t of ["categories", "tests", "questions", "options", "test_questions", "manual_sections", "exam_attempts", "answers"]) {
    const r = await c.execute(`SELECT COUNT(*) as n FROM ${t}`)
    counts[t] = Number(r.rows[0].n)
  }
  console.log("\nConteo de filas:")
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(20)} ${String(v).padStart(6)}`)

  c.close()
}

main().catch(console.error)
