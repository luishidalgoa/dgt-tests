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
  let customerId = user.stripeCustomerId
  if (!customerId) {
    const customer = await stripe.customers.create({
      // No usamos email porque no lo pedimos en registro; usamos username
      // como referencia interna.
      metadata: { appUserId: String(user.id), username: user.username },
      name: user.displayName ?? user.username,
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
