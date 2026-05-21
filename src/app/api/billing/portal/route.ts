import { NextResponse } from "next/server"
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

  const stripe = getStripe()
  const portal = await stripe.billingPortal.sessions.create({
    customer:    user.stripeCustomerId,
    return_url:  appUrl("/settings"),
  })

  return NextResponse.json({ url: portal.url })
}
