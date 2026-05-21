/**
 * Borra TODO el estado Stripe de un user en BBDD: stripeCustomerId,
 * stripeSubscriptionId, subscriptionStatus, etc. Si el role era
 * SUBSCRIBER, lo baja a USER.
 *
 * Útil cuando los IDs en BBDD pertenecen a un ambiente Stripe distinto
 * (típicamente: TEST en dev local contaminó el Turso de prod) y necesitas
 * que el user pueda iniciar una sub LIMPIA en el ambiente actual.
 *
 *   npm run user:clear-stripe -- <username>            (dry-run)
 *   npm run user:clear-stripe -- <username> --apply    (aplicar)
 *
 * NUNCA toca el role ADMIN. Para admins solo limpia los campos Stripe.
 */
import { db } from "@/lib/db"

const APPLY = process.argv.includes("--apply")

async function main() {
  const username = process.argv[2]
  if (!username || username.startsWith("--")) {
    console.error("Uso: clear-user-stripe.ts <username> [--apply]")
    process.exit(1)
  }
  console.log(APPLY ? "🚧 MODO APPLY" : "🔍 MODO DRY-RUN")
  console.log()

  const user = await db.user.findUnique({ where: { username } })
  if (!user) {
    console.error(`✗ No existe el user '${username}'`)
    process.exit(1)
  }

  console.log(`👤 ${user.username} (id ${user.id}, role=${user.role})`)
  console.log(`   stripeCustomerId:             ${user.stripeCustomerId ?? "—"}`)
  console.log(`   stripeSubscriptionId:         ${user.stripeSubscriptionId ?? "—"}`)
  console.log(`   subscriptionStatus:           ${user.subscriptionStatus ?? "—"}`)
  console.log(`   subscriptionPriceId:          ${user.subscriptionPriceId ?? "—"}`)
  console.log(`   subscriptionCurrentPeriodEnd: ${user.subscriptionCurrentPeriodEnd?.toISOString() ?? "—"}`)
  console.log(`   subscriptionCancelAtPeriodEnd: ${user.subscriptionCancelAtPeriodEnd}`)
  console.log()

  const isAdmin = user.role === "ADMIN"
  console.log("Plan:")
  console.log("   → stripeCustomerId, stripeSubscriptionId, subscriptionStatus,")
  console.log("     subscriptionPriceId, subscriptionCurrentPeriodEnd → null")
  console.log("   → subscriptionCancelAtPeriodEnd → false")
  if (!isAdmin && user.role === "SUBSCRIBER") {
    console.log("   → role: SUBSCRIBER → USER")
  } else if (isAdmin) {
    console.log("   → role: ADMIN (no se toca)")
  }
  console.log()

  if (!APPLY) {
    console.log("ℹ Para aplicar: añade --apply")
    return
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      stripeCustomerId:              null,
      stripeSubscriptionId:          null,
      subscriptionStatus:            null,
      subscriptionPriceId:           null,
      subscriptionCurrentPeriodEnd:  null,
      subscriptionCancelAtPeriodEnd: false,
      ...(isAdmin ? {} : (user.role === "SUBSCRIBER" ? { role: "USER" } : {})),
    },
  })
  console.log(`✅ Estado Stripe de '${user.username}' limpiado.`)
  console.log("   Próximo 'Mejorar a PRO' creará un customer limpio en el ambiente actual.")
}

main()
  .catch((e) => { console.error("❌", e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
