/**
 * Cambia el role de un usuario.
 *
 * La lógica vive en src/lib/setUserRole.ts (testeada). Este archivo es
 * un CLI wrapper finísimo.
 *
 *   # Por defecto carga .env + .env.local → si .env.local sobreescribe
 *   #   TURSO a vacío (setup Fase 82), hits SQLite local.
 *   npm run user:role -- luishidalgoa ADMIN
 *
 *   # Para hits explícitos a prod Turso (ignora .env.local):
 *   npm run user:role:prod -- luishidalgoa ADMIN
 */
import { db } from "@/lib/db"
import { parseRoleArg, setUserRole } from "@/lib/setUserRole"

async function main() {
  const [username, rawRole] = process.argv.slice(2)
  if (!username || !rawRole) {
    console.error("Uso: set-role.ts <username> <USER|SUBSCRIBER|ADMIN>")
    process.exit(1)
  }

  const parsed = parseRoleArg(rawRole)
  if ("error" in parsed) {
    console.error(parsed.error)
    process.exit(1)
  }

  const result = await setUserRole(db, username, parsed.role)
  if (!result.ok) {
    console.error(result.error)
    process.exit(1)
  }

  console.log(`✓ ${result.user.username} (id ${result.user.id}) → role = ${result.user.role}`)
}

main()
  .catch((e) => { console.error("❌", e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
