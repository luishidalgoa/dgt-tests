/**
 * Crea (o actualiza) el usuario por defecto del proyecto.
 *
 * Por seguridad NO se debe usar para crear admins en producción si se va a
 * exponer la app — esta cuenta es solo para uso personal del propietario.
 */

import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import bcrypt from "bcryptjs"
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

const DEFAULT_USERNAME = process.env.SEED_USERNAME ?? "54592015"
const DEFAULT_PASSWORD = process.env.SEED_PASSWORD ?? "54592015"

async function main() {
  console.log(`🌱 Seed de usuario "${DEFAULT_USERNAME}"`)
  console.log(`   → DB: ${databaseUrl.slice(0, 60)}...`)

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10)

  const user = await db.user.upsert({
    where:  { username: DEFAULT_USERNAME },
    update: { passwordHash },
    create: {
      username:    DEFAULT_USERNAME,
      passwordHash,
      displayName: DEFAULT_USERNAME,
    },
  })

  console.log(`✅ Usuario listo:`)
  console.log(`   id          : ${user.id}`)
  console.log(`   username    : ${user.username}`)
  console.log(`   displayName : ${user.displayName}`)
  console.log(`   createdAt   : ${user.createdAt.toISOString()}`)
  console.log(`\n   Credenciales:`)
  console.log(`   usuario     : ${DEFAULT_USERNAME}`)
  console.log(`   contraseña  : ${DEFAULT_PASSWORD}`)
}

main()
  .catch((e) => {
    console.error("❌", e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
