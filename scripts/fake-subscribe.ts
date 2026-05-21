/**
 * Marca a un usuario como SUBSCRIBER con subscriptionStatus="active"
 * SIN pasar por Stripe. Útil para probar el lado de la app localmente.
 *
 *   npx tsx --env-file=.env scripts/fake-subscribe.ts <username> [on|off]
 *
 * Ejemplos:
 *   npm run user:fake-subscribe pepito on    → simula suscripción activa
 *   npm run user:fake-subscribe pepito off   → la revoca (vuelve a FREE)
 *
 * NOTA: no toca Stripe. Si la cuenta tiene una suscripción real en Stripe,
 * el siguiente webhook puede sobreescribir lo que hagas aquí.
 */
import { db } from "@/lib/db"

async function main() {
  const [username, action = "on"] = process.argv.slice(2)
  if (!username) {
    console.error("Uso: fake-subscribe.ts <username> [on|off]")
    process.exit(1)
  }
  if (action !== "on" && action !== "off") {
    console.error("La acción debe ser 'on' (activar) u 'off' (revocar)")
    process.exit(1)
  }

  const user = await db.user.findUnique({ where: { username } })
  if (!user) {
    console.error(`No existe el usuario '${username}'`)
    process.exit(1)
  }

  if (user.role === "ADMIN") {
    console.log(`⚠ ${username} es ADMIN — ya tiene acceso total sin necesidad de SUBSCRIBER. Saliendo.`)
    return
  }

  if (action === "on") {
    const nextMonth = new Date()
    nextMonth.setMonth(nextMonth.getMonth() + 1)
    const updated = await db.user.update({
      where: { id: user.id },
      data: {
        role:                         "SUBSCRIBER",
        subscriptionStatus:           "active",
        subscriptionPriceId:          "fake_price_test",
        subscriptionCurrentPeriodEnd: nextMonth,
        stripeCustomerId:             user.stripeCustomerId ?? `cus_fake_${user.id}`,
        stripeSubscriptionId:         user.stripeSubscriptionId ?? `sub_fake_${user.id}`,
      },
    })
    console.log(`✓ ${updated.username} → SUBSCRIBER · activa hasta ${nextMonth.toISOString().slice(0, 10)}`)
  } else {
    const updated = await db.user.update({
      where: { id: user.id },
      data: {
        role:                         "USER",
        subscriptionStatus:           "canceled",
        subscriptionCurrentPeriodEnd: null,
        // mantenemos stripeCustomerId / stripeSubscriptionId por si en el
        // futuro re-activan suscripción real
      },
    })
    console.log(`✓ ${updated.username} → USER · suscripción revocada`)
  }
}

main()
  .catch((e) => { console.error("❌", e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
