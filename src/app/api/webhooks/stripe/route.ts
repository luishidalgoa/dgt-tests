import { NextResponse, type NextRequest } from "next/server"
import type Stripe from "stripe"
import { db } from "@/lib/db"
import { getStripe, STRIPE_WEBHOOK_SECRET, getSubscriptionPeriodEnd } from "@/lib/stripe"

/**
 * Stripe webhook handler.
 *
 * Eventos que escuchamos:
 *   - checkout.session.completed         → primer pago tras suscribirse
 *   - customer.subscription.created      → creación de suscripción
 *   - customer.subscription.updated      → renovaciones, cambios de plan, etc.
 *   - customer.subscription.deleted      → cancelación efectiva
 *
 * Verificamos la firma `stripe-signature` contra `STRIPE_WEBHOOK_SECRET`
 * — si no coincide, devolvemos 400 sin tocar nada.
 *
 * Nunca asignamos role=ADMIN desde aquí; solo USER/SUBSCRIBER.
 */

export const runtime = "nodejs"  // ⚠ NO edge: necesitamos req.text()
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  if (!STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "STRIPE_WEBHOOK_SECRET no configurado" },
      { status: 500 }
    )
  }

  const sig = req.headers.get("stripe-signature")
  if (!sig) {
    return NextResponse.json({ error: "Falta stripe-signature" }, { status: 400 })
  }

  const rawBody = await req.text()
  const stripe = getStripe()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Firma inválida: ${msg}` }, { status: 400 })
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        await onCheckoutCompleted(session)
        break
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription
        await onSubscriptionUpdated(sub)
        break
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription
        await onSubscriptionDeleted(sub)
        break
      }
      default:
        // ignoramos otros eventos
        break
    }
  } catch (err) {
    console.error("[stripe webhook] error handling", event.type, err)
    return NextResponse.json({ error: "Error procesando evento" }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

/** Identifica al usuario interno desde un objeto de Stripe. */
async function resolveUserId(opts: {
  appUserIdMetadata?: string | null
  clientReferenceId?: string | null
  stripeCustomerId?:  string | null
}): Promise<number | null> {
  // 1. Intentar por metadata.appUserId
  const fromMeta = opts.appUserIdMetadata ? parseInt(opts.appUserIdMetadata, 10) : NaN
  if (Number.isInteger(fromMeta) && fromMeta > 0) {
    const exists = await db.user.findUnique({ where: { id: fromMeta }, select: { id: true } })
    if (exists) return fromMeta
  }
  // 2. Intentar por client_reference_id
  const fromRef = opts.clientReferenceId ? parseInt(opts.clientReferenceId, 10) : NaN
  if (Number.isInteger(fromRef) && fromRef > 0) {
    const exists = await db.user.findUnique({ where: { id: fromRef }, select: { id: true } })
    if (exists) return fromRef
  }
  // 3. Por stripeCustomerId
  if (opts.stripeCustomerId) {
    const u = await db.user.findUnique({
      where: { stripeCustomerId: opts.stripeCustomerId },
      select: { id: true },
    })
    if (u) return u.id
  }
  return null
}

async function onCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.mode !== "subscription") return
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null
  const userId = await resolveUserId({
    appUserIdMetadata: session.metadata?.appUserId,
    clientReferenceId: session.client_reference_id ?? null,
    stripeCustomerId:  customerId,
  })
  if (!userId) {
    console.error("[stripe webhook] checkout.session.completed sin usuario", session.id)
    return
  }
  await db.user.update({
    where: { id: userId },
    data: {
      stripeCustomerId: customerId ?? undefined,
    },
  })
  // El customer.subscription.created vendrá poco después; el subscription_id se actualiza ahí.
}

async function onSubscriptionUpdated(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id
  const userId = await resolveUserId({
    appUserIdMetadata: sub.metadata?.appUserId,
    clientReferenceId: null,
    stripeCustomerId:  customerId,
  })
  if (!userId) {
    console.error("[stripe webhook] subscription.updated sin usuario", sub.id)
    return
  }

  const status = sub.status                          // active, past_due, canceled, trialing, ...
  const isActive = status === "active" || status === "trialing"
  const priceId  = sub.items.data[0]?.price?.id ?? null
  const periodEnd = getSubscriptionPeriodEnd(sub)
  const cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end)

  // Solo cambiamos role si NO es admin (los admins son intocables)
  const current = await db.user.findUnique({
    where:  { id: userId },
    select: { role: true },
  })
  const isAdmin = current?.role === "ADMIN"

  await db.user.update({
    where: { id: userId },
    data: {
      stripeCustomerId:              customerId,
      stripeSubscriptionId:          sub.id,
      subscriptionStatus:            status,
      subscriptionPriceId:           priceId,
      subscriptionCurrentPeriodEnd:  periodEnd ? new Date(periodEnd * 1000) : null,
      subscriptionCancelAtPeriodEnd: cancelAtPeriodEnd,
      // role: SUBSCRIBER si activa, USER si no — pero nunca tocamos ADMIN
      ...(isAdmin ? {} : { role: isActive ? "SUBSCRIBER" : "USER" }),
    },
  })
}

async function onSubscriptionDeleted(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id
  const userId = await resolveUserId({
    appUserIdMetadata: sub.metadata?.appUserId,
    clientReferenceId: null,
    stripeCustomerId:  customerId,
  })
  if (!userId) return

  const current = await db.user.findUnique({
    where:  { id: userId },
    select: { role: true },
  })
  const isAdmin = current?.role === "ADMIN"

  // Preservamos la fecha en la que la suscripción terminó para poder
  // mostrar "Tu plan PRO caducó el X" en /settings. Preferimos `ended_at`
  // (set por Stripe cuando la sub efectivamente termina), y caemos a
  // `current_period_end` (top-level o por-item) si por alguna razón no
  // viene.
  const endedTs = (sub as Stripe.Subscription & { ended_at?: number | null }).ended_at
    ?? getSubscriptionPeriodEnd(sub)
  const endedAt = endedTs ? new Date(endedTs * 1000) : null

  await db.user.update({
    where: { id: userId },
    data: {
      subscriptionStatus:            "canceled",
      subscriptionCurrentPeriodEnd:  endedAt,
      subscriptionCancelAtPeriodEnd: false,
      stripeSubscriptionId:          null,
      ...(isAdmin ? {} : { role: "USER" }),
    },
  })
}
