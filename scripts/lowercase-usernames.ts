/**
 * Normaliza username y email de TODOS los usuarios existentes a minúsculas.
 *
 * Contexto (Fase 74): a partir de ahora `username` y `email` se guardan
 * siempre en minúscula (canonical form) para que el login sea case-insensitive
 * trivialmente. Este script migra los registros previos al cambio.
 *
 * Por defecto corre en modo dry-run: muestra qué se cambiaría y detecta
 * conflictos. Para aplicar de verdad, pasar --apply.
 *
 * Idempotente: re-ejecutarlo no rompe nada (los registros ya en minúscula
 * se ignoran).
 *
 *   # dry-run (no toca nada, solo informa)
 *   npx tsx --env-file=.env scripts/lowercase-usernames.ts
 *
 *   # aplicar de verdad (local)
 *   npx tsx --env-file=.env scripts/lowercase-usernames.ts --apply
 *
 *   # aplicar en Turso (asegúrate de tener TURSO_* en .env)
 *   npx tsx --env-file=.env scripts/lowercase-usernames.ts --apply
 */
import { db } from "@/lib/db"

type UserRow = {
  id:       number
  username: string
  email:    string | null
}

async function main() {
  const apply = process.argv.includes("--apply")
  console.log(apply ? "🚧 MODO APPLY (se escribirá en BBDD)" : "🔍 MODO DRY-RUN (no se modifica nada)")
  console.log()

  const users: UserRow[] = await db.user.findMany({
    select: { id: true, username: true, email: true },
    orderBy: { id: "asc" },
  })
  console.log(`📦 Usuarios totales: ${users.length}`)

  // ── 1. Detectar usuarios cuyo username o email NO están en minúscula ──
  const toLowerUsername: UserRow[] = []
  const toLowerEmail:    UserRow[] = []
  for (const u of users) {
    if (u.username !== u.username.toLowerCase()) toLowerUsername.push(u)
    if (u.email && u.email !== u.email.toLowerCase()) toLowerEmail.push(u)
  }
  console.log(`→ Usernames a normalizar: ${toLowerUsername.length}`)
  console.log(`→ Emails a normalizar:    ${toLowerEmail.length}`)

  if (toLowerUsername.length === 0 && toLowerEmail.length === 0) {
    console.log()
    console.log("✓ Nada que hacer — todos los usernames y emails ya están en minúscula.")
    return
  }

  // ── 2. Detectar colisiones (dos usuarios distintos que colapsarían) ──
  // Para username:
  const usernameBuckets = new Map<string, UserRow[]>()
  for (const u of users) {
    const key = u.username.toLowerCase()
    if (!usernameBuckets.has(key)) usernameBuckets.set(key, [])
    usernameBuckets.get(key)!.push(u)
  }
  const usernameConflicts = [...usernameBuckets.entries()].filter(([, list]) => list.length > 1)

  // Para email (ignorando nulls):
  const emailBuckets = new Map<string, UserRow[]>()
  for (const u of users) {
    if (!u.email) continue
    const key = u.email.toLowerCase()
    if (!emailBuckets.has(key)) emailBuckets.set(key, [])
    emailBuckets.get(key)!.push(u)
  }
  const emailConflicts = [...emailBuckets.entries()].filter(([, list]) => list.length > 1)

  if (usernameConflicts.length > 0 || emailConflicts.length > 0) {
    console.log()
    console.error("❌ CONFLICTOS detectados — la migración NO puede aplicarse hasta resolverlos a mano:")
    for (const [key, list] of usernameConflicts) {
      console.error(`   username '${key}' colisionarían: ${list.map((u) => `#${u.id} (${u.username})`).join(", ")}`)
    }
    for (const [key, list] of emailConflicts) {
      console.error(`   email    '${key}' colisionarían: ${list.map((u) => `#${u.id} (${u.email})`).join(", ")}`)
    }
    console.error()
    console.error("Resuélvelos manualmente (renombrar uno de los usuarios o borrar duplicado) y vuelve a correr.")
    process.exit(1)
  }

  // ── 3. Mostrar el plan ──
  console.log()
  console.log("Plan de cambios:")
  for (const u of toLowerUsername) {
    console.log(`   #${u.id}: username '${u.username}' → '${u.username.toLowerCase()}'`)
  }
  for (const u of toLowerEmail) {
    console.log(`   #${u.id}: email    '${u.email}' → '${u.email!.toLowerCase()}'`)
  }

  if (!apply) {
    console.log()
    console.log("ℹ Dry-run terminado. Para aplicar de verdad, vuelve a correr con --apply")
    return
  }

  // ── 4. Aplicar uno a uno (transacción por usuario para evitar líos parciales) ──
  console.log()
  console.log("⏳ Aplicando cambios...")
  let updated = 0
  for (const u of toLowerUsername) {
    await db.user.update({
      where: { id: u.id },
      data:  { username: u.username.toLowerCase() },
    })
    updated++
  }
  for (const u of toLowerEmail) {
    // Puede haber overlap con toLowerUsername; lo aceptamos (update es barato).
    await db.user.update({
      where: { id: u.id },
      data:  { email: u.email!.toLowerCase() },
    })
    updated++
  }
  console.log(`✓ ${updated} actualizaciones aplicadas`)
}

main()
  .catch((e) => {
    console.error("❌", e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
