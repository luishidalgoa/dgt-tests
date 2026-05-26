/**
 * Lógica pura de cálculo de fechas para la renovación de tokens IA.
 *
 * Vive separada de aiQuota.ts y del webhook de Stripe para poder probarse
 * sin mocks de BBDD ni de Stripe. Tres reglas:
 *
 *   1. FREE nunca PRO  → aniversario mensual de createdAt
 *   2. PRO activo      → subscriptionCurrentPeriodEnd (avanza con Stripe)
 *   3. Ex-PRO          → aniversario mensual desde fecha de expiry
 *
 * Todas las fechas en UTC. Maneja días tipo 31 → 28/29/30 cayendo al mes corto.
 */

/** Avanza una fecha 1 mes en UTC, capando días tipo 31 → 30/28/29. */
export function addOneMonthUtc(d: Date): Date {
  const day = d.getUTCDate()
  const next = new Date(d.getTime())
  // Primero al día 1 para evitar saltos cuando el mes destino es más corto
  next.setUTCDate(1)
  next.setUTCMonth(next.getUTCMonth() + 1)
  // Cap al último día del mes destino
  const lastDayOfTarget = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate()
  next.setUTCDate(Math.min(day, lastDayOfTarget))
  return next
}

/** Avanza la fecha mes a mes hasta que sea estrictamente > `now`. */
export function advanceUntilFuture(date: Date, now: Date): Date {
  let next = new Date(date.getTime())
  while (next <= now) {
    next = addOneMonthUtc(next)
  }
  return next
}

/**
 * Calcula la fecha INICIAL de renovación de tokens al registrarse un usuario.
 * Es siempre createdAt + 1 mes — el caso PRO se inicializa después vía
 * webhook de Stripe (subscription.created → onSubscriptionUpdated).
 */
export function computeRegistrationRenewal(createdAt: Date): Date {
  return addOneMonthUtc(createdAt)
}

/**
 * Calcula la fecha de renovación para un usuario que NO la tiene seteada
 * (campo null en BBDD — lazy backfill). Considera su estado actual:
 *   - Si tiene `subscriptionCurrentPeriodEnd` (es/fue PRO) → ancla ahí
 *   - Si no → ancla en createdAt + 1 mes
 * Luego avanza meses hasta llegar a futuro.
 */
export function computeInitialRenewal(
  user: { createdAt: Date; subscriptionCurrentPeriodEnd: Date | null },
  now: Date,
): Date {
  const firstRenewal = user.subscriptionCurrentPeriodEnd
    ?? addOneMonthUtc(user.createdAt)
  return advanceUntilFuture(firstRenewal, now)
}

/**
 * Calcula qué hacer tras un evento `customer.subscription.created/updated`.
 *
 *   - Si `newPeriodEnd` es null → no cambia nada (no podemos anclar a nada)
 *   - Si avanzó (new > old o old=null) → es renovación REAL → reset contador
 *   - Si no avanzó → solo sincroniza fecha sin resetear
 */
export function computeRenewalAfterSubUpdate(
  newPeriodEnd: Date | null,
  oldPeriodEnd: Date | null,
): { aiTokensRenewalAt: Date | null; shouldResetTokens: boolean } {
  if (!newPeriodEnd) return { aiTokensRenewalAt: null, shouldResetTokens: false }
  const isRenewal = oldPeriodEnd === null || newPeriodEnd > oldPeriodEnd
  return { aiTokensRenewalAt: newPeriodEnd, shouldResetTokens: isRenewal }
}

/**
 * Calcula qué hacer tras un evento `customer.subscription.deleted` (expiry).
 *
 * Política: la sub caducó → user pasa a FREE → primer reset 1 mes después
 * de la fecha de expiry (siguiente aniversario). Reset inmediato del
 * contador para empezar el plan FREE con quota fresca.
 */
export function computeRenewalAfterSubExpiry(
  endedAt: Date | null,
): { aiTokensRenewalAt: Date | null; shouldResetTokens: boolean } {
  if (!endedAt) return { aiTokensRenewalAt: null, shouldResetTokens: true }
  return {
    aiTokensRenewalAt: addOneMonthUtc(endedAt),
    shouldResetTokens: true,
  }
}
