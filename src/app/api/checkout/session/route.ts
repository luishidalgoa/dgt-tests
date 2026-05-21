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
  //    Lógica en 3 pasos:
  //    a) Si BBDD tiene stripeCustomerId, intentar retrieve. Si funciona,
  //       usar ese. Si no (borrado, cross-ambiente), NO buscamos por
  //       metadata — el índice de search es eventually consistent y nos
  //       devolvería el mismo zombi durante minutos/horas. Mejor crear
  //       uno nuevo limpio y dejar de pelearnos con el cache de Stripe.
  //    b) Si BBDD NO tiene stripeCustomerId, sí buscamos por metadata por
  //       si hay un customer huérfano de antes (validando cada candidato).
  //    c) Si nada de eso, creamos uno nuevo.
  let customerId: string | null = null
  let hadStaleDbId = false

  if (user.stripeCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(user.stripeCustomerId)
      if (existing.deleted) {
        hadStaleDbId = true
      } else {
        customerId = user.stripeCustomerId
      }
    } catch (err) {
      // No existe (borrado o cross-ambiente). Marcamos para limpiar BBDD.
      console.warn(
        `[checkout] stripeCustomerId '${user.stripeCustomerId}' no existe en Stripe (${err instanceof Error ? err.message : err}). Creando uno nuevo.`
      )
      hadStaleDbId = true
    }
  }

  // Solo buscamos por metadata si la BBDD NUNCA tuvo customer — para
  // descubrir orphans antiguos. Si tenía y se borró, vamos directo a
  // crear uno nuevo (evita el problema del índice stale).
  if (!customerId && !hadStaleDbId && !user.stripeCustomerId) {
    try {
      const search = await stripe.customers.search({
        query: `metadata['appUserId']:'${user.id}'`,
        limit: 5,
      })
      if (search.data.length > 0) {
        const sorted = [...search.data].sort((a, b) => b.created - a.created)
        for (const candidate of sorted) {
          try {
            const fresh = await stripe.customers.retrieve(candidate.id)
            if (fresh.deleted) continue
            customerId = candidate.id
            console.log(
              `[checkout] Reusando customer huérfano '${customerId}' (encontrado por metadata).` +
              (search.data.length > 1 ? ` ⚠ Hay ${search.data.length} candidatos — corre npm run stripe:audit.` : "")
            )
            break
          } catch {
            console.warn(
              `[checkout] search devolvió '${candidate.id}' pero retrieve falló — índice stale, ignoro.`
            )
          }
        }
        if (customerId) {
          await db.user.update({
            where: { id: user.id },
            data:  { stripeCustomerId: customerId },
          })
        }
      }
    } catch (err) {
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
    if (hadStaleDbId) {
      console.log(`[checkout] BBDD limpiada: ahora stripeCustomerId='${customerId}' (sustituye al zombi).`)
    }
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
