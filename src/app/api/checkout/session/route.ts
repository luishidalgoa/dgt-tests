import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { hasFullAccess } from "@/lib/permissions"
import { appUrl, getStripe, STRIPE_PRICE_ID } from "@/lib/stripe"

/**
 * POST /api/checkout/session
 *
 * Crea una Stripe Checkout Session para suscribirse al plan PRO.
 * Devuelve `{ url }` para redirigir al usuario.
 */
export async function POST() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Necesitas iniciar sesión" }, { status: 401 })
  }
  // Ya tiene acceso completo — no necesita pagar
  if (hasFullAccess(user)) {
    return NextResponse.json({ error: "Ya tienes acceso completo" }, { status: 400 })
  }
  if (!STRIPE_PRICE_ID) {
    return NextResponse.json(
      { error: "El servidor no tiene STRIPE_PRICE_ID configurado" },
      { status: 500 }
    )
  }

  const stripe = getStripe()

  // 1. Crear/recuperar Customer
  //    Defendemos contra dos problemas:
  //    a) "cross-ambiente": un customer creado en LIVE no existe en TEST.
  //    b) "orphans": si el id guardado se perdió o nunca se guardó, antes
  //       creábamos otro nuevo a ciegas — eso generaba duplicados en
  //       Stripe (un user con 2 customers, uno cobrando sin que la app
  //       lo sepa). Ahora, antes de crear, buscamos por metadata.appUserId.
  let customerId: string | null = user.stripeCustomerId
  if (customerId) {
    try {
      const existing = await stripe.customers.retrieve(customerId)
      if (existing.deleted) {
        customerId = null
      }
    } catch (err) {
      // Most likely "No such customer" (ambiente distinto). Forzamos recreación.
      console.warn(
        `[checkout] stripeCustomerId '${customerId}' no existe en este ambiente: ${err instanceof Error ? err.message : err}. Buscando por metadata.`
      )
      customerId = null
    }
  }

  // Fallback: buscar por metadata.appUserId antes de crear uno nuevo.
  if (!customerId) {
    try {
      const search = await stripe.customers.search({
        query: `metadata['appUserId']:'${user.id}'`,
        limit: 5,
      })
      if (search.data.length > 0) {
        // Si hay varios, preferimos el más reciente (ordena por created desc)
        const sorted = [...search.data].sort((a, b) => b.created - a.created)
        customerId = sorted[0].id
        console.warn(
          `[checkout] Reusando customer existente '${customerId}' encontrado por metadata.` +
          (search.data.length > 1
            ? ` ⚠ Hay ${search.data.length} customers con appUserId=${user.id} — considera limpiar duplicados (npm run stripe:audit).`
            : "")
        )
        await db.user.update({
          where: { id: user.id },
          data:  { stripeCustomerId: customerId },
        })
      }
    } catch (err) {
      // customers.search puede tardar unos segundos en indexar customers
      // recién creados. Si falla, seguimos con el flujo de creación.
      console.warn(
        `[checkout] customers.search falló (sigo y creo uno nuevo): ${err instanceof Error ? err.message : err}`
      )
    }
  }

  if (!customerId) {
    const customer = await stripe.customers.create({
      metadata: { appUserId: String(user.id), username: user.username },
      name: user.displayName ?? user.username,
      // Si el usuario tiene email guardado, lo usamos para que Stripe lo
      // muestre prerellenado en el Checkout y para poder identificarlo
      // luego en el dashboard.
      ...(user.email ? { email: user.email } : {}),
    })
    customerId = customer.id
    await db.user.update({
      where: { id: user.id },
      data:  { stripeCustomerId: customerId },
    })
  }

  // 2. Crear Checkout Session
  const session = await stripe.checkout.sessions.create({
    mode:        "subscription",
    customer:    customerId,
    line_items:  [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    success_url: appUrl("/settings?subscribed=1"),
    cancel_url:  appUrl("/upgrade?canceled=1"),
    // Repetimos appUserId también en la session para tener fallback en webhook
    client_reference_id: String(user.id),
    metadata: { appUserId: String(user.id) },
    // Permitimos cupones, dirección de facturación automática
    allow_promotion_codes: true,
    billing_address_collection: "auto",
  })

  if (!session.url) {
    return NextResponse.json({ error: "Stripe no devolvió url de checkout" }, { status: 500 })
  }

  return NextResponse.json({ url: session.url })
}
