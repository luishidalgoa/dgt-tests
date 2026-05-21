/**
 * Sincroniza el estado de la suscripción de un usuario desde Stripe.
 *
 * Útil cuando:
 *   - El webhook falló (firma incorrecta, server caído) y la BBDD no
 *     refleja una suscripción real.
 *   - Quieres VERIFICAR que la suscripción de un usuario está activa.
 *   - Estás depurando y necesitas la fuente de verdad de Stripe.
 *
 *   npx tsx --env-file=.env scripts/sync-subscription-from-stripe.ts <username>
 *
 * Lee desde Stripe y actualiza User.role, subscriptionStatus,
 * stripeSubscriptionId, subscriptionPriceId y subscriptionCurrentPeriodEnd
 * para que coincidan con lo que ve Stripe en ese momento.
 *
 * Nunca cambia a ADMIN — solo USER ↔ SUBSCRIBER.
 */
import Stripe from "stripe"
import { db } from "@/lib/db"

async function main() {
  const username = process.argv[2]
  if (!username) {
    console.error("Uso: sync-subscription-from-stripe.ts <username>")
    process.exit(1)
  }

  const apiKey = process.env.STRIPE_SECRET_KEY
  if (!apiKey) {
    console.error("✗ STRIPE_SECRET_KEY no definida en .env")
    process.exit(1)
  }

  const user = await db.user.findUnique({ where: { username } })
  if (!user) {
    console.error(`✗ No existe el usuario '${username}'`)
    process.exit(1)
  }

  console.log(`👤 ${user.username} (id ${user.id})`)
  console.log(`   role actual:                 ${user.role}`)
  console.log(`   subscriptionStatus actual:   ${user.subscriptionStatus ?? "—"}`)
  console.log(`   stripeCustomerId:            ${user.stripeCustomerId ?? "—"}`)
  console.log()

  if (user.role === "ADMIN") {
    console.log("⚠ Es ADMIN — no se toca el role. Solo se actualiza la info de Stripe si existe customer.")
  }

  const stripe = new Stripe(apiKey)

  // 1. Buscar el customer en Stripe. Primero por stripeCustomerId; si no
  //    tiene, buscar por metadata.appUserId.
  let customer: Stripe.Customer | null = null
  if (user.stripeCustomerId) {
    try {
      const c = await stripe.customers.retrieve(user.stripeCustomerId)
      if (!c.deleted) customer = c as Stripe.Customer
    } catch (err) {
      console.log(`⚠ stripeCustomerId '${user.stripeCustomerId}' no existe en Stripe.`)
    }
  }

  if (!customer) {
    console.log("→ Buscando customer en Stripe por metadata.appUserId...")
    const search = await stripe.customers.search({
      query: `metadata['appUserId']:'${user.id}'`,
      limit: 5,
    })
    if (search.data.length > 0) {
      customer = search.data[0]
      console.log(`✓ Encontrado: ${customer.id}`)
    }
  }

  if (!customer) {
    console.log()
    console.log("✗ No hay customer en Stripe para este usuario.")
    console.log("  Significa que NUNCA ha iniciado un checkout. Reseteo a USER si estaba SUBSCRIBER.")
    if (user.role === "SUBSCRIBER") {
      await db.user.update({
        where: { id: user.id },
        data:  { role: "USER", subscriptionStatus: "canceled", subscriptionCurrentPeriodEnd: null },
      })
      console.log("  ✓ role → USER, status → canceled")
    }
    return
  }

  // 2. Listar suscripciones del customer
  const subs = await stripe.subscriptions.list({
    customer: customer.id,
    status: "all",
    limit: 10,
  })

  if (subs.data.length === 0) {
    console.log(`\n✗ El customer ${customer.id} no tiene NINGUNA suscripción.`)
    if (user.role === "SUBSCRIBER") {
      await db.user.update({
        where: { id: user.id },
        data: {
          role:                         "USER",
          subscriptionStatus:           "canceled",
          stripeSubscriptionId:         null,
          subscriptionCurrentPeriodEnd: null,
          stripeCustomerId:             customer.id,
        },
      })
      console.log("✓ role → USER")
    } else {
      await db.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customer.id },
      })
      console.log("✓ stripeCustomerId guardado.")
    }
    return
  }

  console.log(`\n📋 ${subs.data.length} suscripción(es) en Stripe:`)
  for (const s of subs.data) {
    const pid = s.items.data[0]?.price?.id ?? "—"
    const periodEnd = (s as Stripe.Subscription & { current_period_end?: number }).current_period_end
    console.log(`   ${s.id} · status=${s.status} · price=${pid}` +
      (periodEnd ? ` · periodEnd=${new Date(periodEnd * 1000).toISOString().slice(0, 10)}` : ""))
  }

  // Coger la "mejor" suscripción: una activa o trialing si existe, si no la más reciente
  const active = subs.data.find((s) => s.status === "active" || s.status === "trialing")
  const chosen = active ?? subs.data[0]
  const isActive = chosen.status === "active" || chosen.status === "trialing"
  const priceId  = chosen.items.data[0]?.price?.id ?? null
  const periodEnd = (chosen as Stripe.Subscription & { current_period_end?: number }).current_period_end

  console.log()
  console.log(`→ Usando ${chosen.id} (status=${chosen.status})`)

  const isAdmin = user.role === "ADMIN"
  await db.user.update({
    where: { id: user.id },
    data: {
      stripeCustomerId:             customer.id,
      stripeSubscriptionId:         chosen.id,
      subscriptionStatus:           chosen.status,
      subscriptionPriceId:          priceId,
      subscriptionCurrentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      ...(isAdmin ? {} : { role: isActive ? "SUBSCRIBER" : "USER" }),
    },
  })

  console.log(`✅ BBDD actualizada:`)
  console.log(`   role:              ${isAdmin ? "ADMIN (no tocado)" : isActive ? "SUBSCRIBER" : "USER"}`)
  console.log(`   subscriptionStatus: ${chosen.status}`)
  if (periodEnd) console.log(`   currentPeriodEnd:  ${new Date(periodEnd * 1000).toISOString()}`)
}

main()
  .catch((e) => { console.error("❌", e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
