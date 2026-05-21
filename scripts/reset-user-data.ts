/**
 * Borra TODOS los datos del usuario (attempts, answers, party participations)
 * y opcionalmente renombra el username.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/reset-user-data.ts <username> [newUsername]
 *
 * Ejemplos:
 *   npx tsx --env-file=.env scripts/reset-user-data.ts 54592015
 *   npx tsx --env-file=.env scripts/reset-user-data.ts 54592015 luishidalgoa
 */

import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const databaseUrl =
  process.env.TURSO_DATABASE_URL ??
  pathToFileURL(resolve(process.cwd(), "prisma", "dev.db")).href

const adapter = new PrismaLibSql({
  url:       databaseUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

const db = new PrismaClient({ adapter })

async function main() {
  const username    = process.argv[2]
  const newUsername = process.argv[3]

  if (!username) {
    console.error("Uso: scripts/reset-user-data.ts <username> [newUsername]")
    process.exit(1)
  }

  console.log(`📡 DB: ${databaseUrl.slice(0, 60)}...`)
  console.log(`🔍 Buscando usuario '${username}'...`)

  const user = await db.user.findUnique({ where: { username } })
  if (!user) {
    console.error(`✗ Usuario '${username}' no encontrado`)
    process.exit(1)
  }

  console.log(`✓ Usuario id=${user.id}\n`)

  // Conteo previo
  const before = {
    answers:        await db.answer.count({ where: { attempt: { userId: user.id } } }),
    attempts:       await db.examAttempt.count({ where: { userId: user.id } }),
    partyAnswers:   await db.partyAnswer.count({ where: { player: { userId: user.id } } }),
    partyPlayers:   await db.partyPlayer.count({ where: { userId: user.id } }),
    hostedParties:  await db.party.count({ where: { hostUserId: user.id } }),
  }
  console.log("Antes:")
  for (const [k, v] of Object.entries(before)) console.log(`  ${k.padEnd(15)} ${v}`)

  console.log("\n🗑  Borrando...")

  // Borrar en orden por las FKs (las cascadas también funcionan pero por claridad)
  await db.answer.deleteMany({ where: { attempt: { userId: user.id } } })
  await db.examAttempt.deleteMany({ where: { userId: user.id } })

  // Party participations
  await db.partyAnswer.deleteMany({ where: { player: { userId: user.id } } })
  await db.partyPlayer.deleteMany({ where: { userId: user.id } })

  // Parties que hosteó (cascada borra players + answers)
  await db.party.deleteMany({ where: { hostUserId: user.id } })

  console.log("✅ Datos borrados\n")

  // Rename si procede
  if (newUsername && newUsername !== username) {
    const existing = await db.user.findUnique({ where: { username: newUsername } })
    if (existing) {
      console.error(`✗ El username '${newUsername}' ya existe (id=${existing.id})`)
      process.exit(1)
    }
    await db.user.update({
      where: { id: user.id },
      data:  { username: newUsername, displayName: newUsername },
    })
    console.log(`✏️  Renombrado: ${username} → ${newUsername}`)
  }

  // Conteo después
  const after = {
    answers:       await db.answer.count({ where: { attempt: { userId: user.id } } }),
    attempts:      await db.examAttempt.count({ where: { userId: user.id } }),
    partyAnswers:  await db.partyAnswer.count({ where: { player: { userId: user.id } } }),
    partyPlayers:  await db.partyPlayer.count({ where: { userId: user.id } }),
    hostedParties: await db.party.count({ where: { hostUserId: user.id } }),
  }
  console.log("\nDespués:")
  for (const [k, v] of Object.entries(after)) console.log(`  ${k.padEnd(15)} ${v}`)
}

main()
  .catch((e) => { console.error("❌", e); process.exit(1) })
  .finally(() => db.$disconnect())
