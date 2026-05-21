/**
 * Cambia el role de un usuario.
 *
 *   npx tsx --env-file=.env scripts/set-role.ts <username> <USER|SUBSCRIBER|ADMIN>
 *
 * Ejemplos:
 *   npx tsx --env-file=.env scripts/set-role.ts luishidalgoa ADMIN
 *   npx tsx --env-file=.env scripts/set-role.ts pepito USER
 */
import { db } from "@/lib/db"

const VALID_ROLES = ["USER", "SUBSCRIBER", "ADMIN"] as const
type Role = (typeof VALID_ROLES)[number]

async function main() {
  const [username, rawRole] = process.argv.slice(2)
  if (!username || !rawRole) {
    console.error("Uso: set-role.ts <username> <USER|SUBSCRIBER|ADMIN>")
    process.exit(1)
  }
  const role = rawRole.toUpperCase() as Role
  if (!VALID_ROLES.includes(role)) {
    console.error(`Rol inválido. Usa uno de: ${VALID_ROLES.join(", ")}`)
    process.exit(1)
  }

  const user = await db.user.findUnique({ where: { username } })
  if (!user) {
    console.error(`No existe el usuario '${username}'`)
    process.exit(1)
  }

  const updated = await db.user.update({
    where: { username },
    data:  { role },
  })

  console.log(`✓ ${updated.username} (id ${updated.id}) → role = ${updated.role}`)
}

main()
  .catch((e) => {
    console.error("❌", e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
