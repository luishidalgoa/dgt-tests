import { NextResponse, type NextRequest } from "next/server"
import type Stripe from "stripe"
import { db } from "@/lib/db"
import { getStripe, getStripeWebhookSecret, getSubscriptionPeriodEnd, willNotAutoRenew, getSubscriptionEndDate, appUrl } from "@/lib/stripe"
import { handleChargeRefunded } from "@/lib/handleChargeRefunded"
import { composePaymentFailedEmail, composeInvoiceUpcomingEmail, sendUserEmail } from "@/lib/userEmails"

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
  let webhookSecret: string
  try {
    webhookSecret = await getStripeWebhookSecret()
  } catch {
    webhookSecret = ""
  }
  if (!webhookSecret) {
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
  const stripe = await getStripe()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
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
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice
        await onInvoicePaymentFailed(invoice)
        break
      }
      case "invoice.upcoming": {
        const invoice = event.data.object as Stripe.Invoice
        await onInvoiceUpcoming(invoice)
        break
      }
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await handleChargeRefunded(charge, { db: db as any, stripe })
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
  // Bug Fase 85: el portal de Stripe expresa la cancelación de DOS formas
  // (cancel_at_period_end bool O cancel_at timestamp). Antes solo mirábamos
  // el boolean → la BBDD decía "active renewal" mientras Stripe decía
  // "scheduled to cancel". Ahora usamos los helpers que cubren ambos casos.
  const endDateTs = getSubscriptionEndDate(sub)
  const cancelAtPeriodEnd = willNotAutoRenew(sub)

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
      subscriptionCurrentPeriodEnd:  endDateTs ? new Date(endDateTs * 1000) : null,
      subscriptionCancelAtPeriodEnd: cancelAtPeriodEnd,
      // role: SUBSCRIBER si activa, USER si no — pero nunca tocamos ADMIN
      ...(isAdmin ? {} : { role: isActive ? "SUBSCRIBER" : "USER" }),
    },
  })
}

/**
 * Cobro automático fallido (renovación o reintento).
 *
 * Stripe seguirá reintentando ~3 semanas. Durante ese tiempo:
 *   - `customer.subscription.updated` llegará con status="past_due"
 *   - Nuestro `hasFullAccess` permite past_due como grace period
 *   - El user mantiene acceso PRO
 *
 * Adicionalmente enviamos email al user para que actualice su tarjeta
 * antes de quedarse sin acceso (Fase 89).
 */
async function onInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === "string"
    ? invoice.customer
    : invoice.customer?.id ?? null
  console.warn("[stripe webhook] invoice.payment_failed", {
    invoiceId:          invoice.id,
    customerId,
    amountDue:          invoice.amount_due,
    attemptCount:       invoice.attempt_count,
    nextPaymentAttempt: invoice.next_payment_attempt,
  })

  if (!customerId) return
  const user = await db.user.findFirst({ where: { stripeCustomerId: customerId } })
  if (!user || !user.email) {
    console.warn("[stripe webhook] invoice.payment_failed: sin user/email, skip email")
    return
  }

  const { subject, html } = composePaymentFailedEmail(
    { username: user.username, displayName: user.displayName, email: user.email },
    {
      amountCents:   invoice.amount_due ?? 0,
      currency:      invoice.currency ?? "eur",
      nextAttemptTs: invoice.next_payment_attempt ?? null,
      attemptCount:  invoice.attempt_count ?? 1,
      portalUrl:     appUrl("/settings"),
    }
  )
  await sendUserEmail({ to: user.email, subject, html })
}

/**
 * Aviso ~1 día antes de un cobro de renovación (configurable en Stripe).
 * No cambia BBDD; solo notifica al user.
 */
async function onInvoiceUpcoming(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === "string"
    ? invoice.customer
    : invoice.customer?.id ?? null
  console.log("[stripe webhook] invoice.upcoming", {
    invoiceId:    invoice.id,
    customerId,
    amountDue:    invoice.amount_due,
    periodEnd:    invoice.period_end,
  })

  if (!customerId) return
  const user = await db.user.findFirst({ where: { stripeCustomerId: customerId } })
  if (!user || !user.email) {
    console.warn("[stripe webhook] invoice.upcoming: sin user/email, skip email")
    return
  }

  const { subject, html } = composeInvoiceUpcomingEmail(
    { username: user.username, displayName: user.displayName, email: user.email },
    {
      amountCents:    invoice.amount_due ?? 0,
      currency:       invoice.currency ?? "eur",
      willChargeOnTs: invoice.period_end ?? Math.floor(Date.now() / 1000),
      portalUrl:      appUrl("/settings"),
    }
  )
  await sendUserEmail({ to: user.email, subject, html })
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
