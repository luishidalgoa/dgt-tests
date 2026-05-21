/**
 * Borra todos los attempts y answers (datos de testing) antes de aplicar
 * la migración que añade userId como NOT NULL.
 *
 * Borra en local Y en Turso si TURSO_DATABASE_URL está definida.
 */

import { createClient } from "@libsql/client"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

async function clear(label: string, url: string, authToken?: string) {
  const client = createClient({ url, authToken })
  console.log(`\n📍 ${label}`)
  try {
    const before = await client.execute("SELECT COUNT(*) as n FROM exam_attempts")
    console.log(`   antes  : ${before.rows[0].n} attempts`)
    await client.execute("DELETE FROM answers")
    await client.execute("DELETE FROM exam_attempts")
    const after = await client.execute("SELECT COUNT(*) as n FROM exam_attempts")
    console.log(`   después: ${after.rows[0].n} attempts`)
  } catch (e) {
    console.log(`   ⚠️  no se pudo limpiar: ${(e as Error).message.slice(0, 80)}`)
  }
  client.close()
}

async function main() {
  // Local
  const localUrl = pathToFileURL(resolve(process.cwd(), "prisma", "dev.db")).href
  await clear("LOCAL (dev.db)", localUrl)

  // Turso
  if (process.env.TURSO_DATABASE_URL) {
    await clear("TURSO", process.env.TURSO_DATABASE_URL, process.env.TURSO_AUTH_TOKEN)
  } else {
    console.log("\n📍 TURSO: sin TURSO_DATABASE_URL, salto")
  }
}

main().catch((e) => {
  console.error("❌", e)
  process.exit(1)
})
