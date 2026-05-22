import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { appUrl, getStripe } from "@/lib/stripe"

/**
 * POST /api/billing/portal
 *
 * Crea una sesión del Stripe Customer Portal para que el usuario pueda:
 * - Ver/descargar facturas
 * - Actualizar método de pago
 * - Cancelar la suscripción
 *
 * Devuelve `{ url }` para redirigir.
 */
export async function POST() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Necesitas iniciar sesión" }, { status: 401 })
  }
  if (!user.stripeCustomerId) {
    return NextResponse.json(
      { error: "No tienes ninguna suscripción asociada" },
      { status: 400 }
    )
  }

  const stripe = await getStripe()

  // Verificar que el customer existe en el ambiente actual de Stripe.
  // Si el id se generó en otro ambiente (LIVE↔TEST), no lo encontrará.
  try {
    const existing = await stripe.customers.retrieve(user.stripeCustomerId)
    if (existing.deleted) {
      await db.user.update({
        where: { id: user.id },
        data:  { stripeCustomerId: null },
      })
      return NextResponse.json(
        { error: "Tu cliente de Stripe fue eliminado. Inicia una nueva suscripción." },
        { status: 400 }
      )
    }
  } catch (err) {
    // No such customer: probablemente cross-ambiente. Limpiamos para que
    // el próximo intento de checkout cree uno nuevo limpio.
    console.warn(
      `[billing/portal] stripeCustomerId '${user.stripeCustomerId}' no existe en este ambiente: ${err instanceof Error ? err.message : err}`
    )
    await db.user.update({
      where: { id: user.id },
      data:  { stripeCustomerId: null },
    })
    return NextResponse.json(
      {
        error:
          "Tu cliente de Stripe pertenece a otro ambiente (live/test). " +
          "Inicia una nueva suscripción para vincular un cliente en el ambiente actual.",
      },
      { status: 400 }
    )
  }

  const portal = await stripe.billingPortal.sessions.create({
    customer:    user.stripeCustomerId,
    return_url:  appUrl("/settings"),
  })

  return NextResponse.json({ url: portal.url })
}
