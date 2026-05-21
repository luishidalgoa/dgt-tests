/**
 * Prepara un usuario local para hacer pruebas E2E de Stripe / suscripción.
 *
 * Asegura que tenga:
 *   - email (Stripe Checkout lo requiere)
 *   - password conocida (la que le pasamos)
 *   - estado Stripe limpio (sin customerId/subscriptionId residual)
 *   - role USER (sin acceso PRO inicialmente; el flujo de prueba lo sube)
 *
 *   npm run dev:prepare-test-user
 *       → username=test, email=test@dgt-tests.local, password=test1234
 *
 *   npm run dev:prepare-test-user -- --username luisph --password foo
 *       → custom
 *
 * Si el user no existe, lo crea.
 *
 * NUNCA correr contra prod (.env). Cargamos .env + .env.local para que el
 * override de TURSO_* vaya a la BBDD local. Si alguien lo hace por error
 * contra Turso prod, al menos la password no es nada secreta.
 */
import bcrypt from "bcryptjs"
import { db } from "@/lib/db"

const args = process.argv.slice(2)
function getArg(name: string, def: string): string {
  const i = args.indexOf(`--${name}`)
  if (i >= 0 && args[i + 1]) return args[i + 1]
  return def
}

const USERNAME = getArg("username", "test")
const EMAIL    = getArg("email",    "test@dgt-tests.local")
const PASSWORD = getArg("password", "test1234")

async function main() {
  console.log(`🧪 Preparando user de prueba`)
  console.log(`   username : ${USERNAME}`)
  console.log(`   email    : ${EMAIL}`)
  console.log(`   password : ${PASSWORD}`)
  console.log()

  const passwordHash = await bcrypt.hash(PASSWORD, 10)

  const existing = await db.user.findUnique({ where: { username: USERNAME } })

  const data = {
    passwordHash,
    email: EMAIL.toLowerCase(),
    role: "USER" as const,
    // Limpiar cualquier Stripe state residual
    stripeCustomerId:             null,
    stripeSubscriptionId:         null,
    subscriptionStatus:           null,
    subscriptionPriceId:          null,
    subscriptionCurrentPeriodEnd: null,
    subscriptionCancelAtPeriodEnd: false,
  }

  const user = existing
    ? await db.user.update({ where: { id: existing.id }, data })
    : await db.user.create({
        data: {
          username: USERNAME.toLowerCase(),
          displayName: USERNAME,
          ...data,
        },
      })

  console.log(existing ? `✅ User existente actualizado:` : `✅ User creado:`)
  console.log(`   id           : ${user.id}`)
  console.log(`   username     : ${user.username}`)
  console.log(`   email        : ${user.email}`)
  console.log(`   role         : ${user.role}`)
  console.log(`   stripe state : limpio`)
  console.log()
  console.log(`📝 Para loguearte:`)
  console.log(`   user/email   : ${USERNAME} (o ${EMAIL})`)
  console.log(`   password     : ${PASSWORD}`)
}

main()
  .catch((e) => { console.error("❌", e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
