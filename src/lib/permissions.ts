/**
 * Reglas de acceso del usuario según su rol y estado de suscripción.
 *
 * Hay 3 roles:
 *   - USER:       cuenta gratis. Acceso solo a los 7 primeros tests de
 *                 Permiso B + 10 tokens IA/mes.
 *   - SUBSCRIBER: usuario con suscripción Stripe activa. Acceso total
 *                 + AI_TOKENS_PRO tokens IA/mes (ver constante abajo).
 *   - ADMIN:      acceso total sin pagar. Asignado a mano por script.
 *
 * El rol SUBSCRIBER se gestiona automáticamente desde el webhook de
 * Stripe (subscription.updated → role=SUBSCRIBER; subscription.deleted →
 * role=USER). El rol ADMIN nunca se cambia desde el webhook.
 */

import type { User } from "@prisma/client"

/** Slug de la categoría accesible para usuarios FREE / guest. */
export const FREE_CATEGORY_SLUG = "permiso-b"

/** Número máximo de tests accesibles en la categoría free. */
export const FREE_TEST_LIMIT = 7

/** Tokens IA por mes según plan. */
export const AI_TOKENS_FREE = 10
export const AI_TOKENS_PRO  = 60

export type UserForGate = Pick<User, "role" | "subscriptionStatus"> | null

/**
 * El usuario tiene acceso completo (rol ADMIN, o SUBSCRIBER con sub viva).
 *
 * "Viva" incluye:
 *   - active / trialing → cobros OK
 *   - past_due → Stripe está reintentando el cobro. Le damos al user un
 *     grace period (~3 semanas, lo que Stripe reintenta por defecto)
 *     para que pueda actualizar su tarjeta sin perder el servicio.
 *     Cuando Stripe se rinde, mueve a canceled/unpaid → acceso fuera.
 */
export function hasFullAccess(user: UserForGate): boolean {
  if (!user) return false
  if (user.role === "ADMIN") return true
  if (user.role !== "SUBSCRIBER") return false
  return isActiveSubscription(user.subscriptionStatus) || isInGracePeriod(user)
}

/**
 * ¿La suscripción del user está en grace period (Stripe reintenta cobros)?
 *
 * Solo aplica al status past_due. Stripe NO usa past_due para subs
 * pagadas correctamente; solo aparece cuando un cobro automático falló.
 */
export function isInGracePeriod(user: UserForGate): boolean {
  if (!user) return false
  if (user.role !== "SUBSCRIBER") return false
  return user.subscriptionStatus === "past_due"
}

/** El usuario es admin (acceso total sin facturación). */
export function isAdmin(user: UserForGate): boolean {
  return !!user && user.role === "ADMIN"
}

/**
 * ¿Está la suscripción "viva" (cobrando o en trial)? Estos son los estados
 * de Stripe que mantienen el acceso premium.
 */
export function isActiveSubscription(status: string | null | undefined): boolean {
  if (!status) return false
  return status === "active" || status === "trialing"
}

/** ¿Puede acceder a este test concreto? */
export function canAccessTest(
  user: UserForGate,
  categoriaSlug: string,
  testNumber: number
): boolean {
  if (hasFullAccess(user)) return true
  // Free / guest: solo permiso-b 1..7
  return categoriaSlug === FREE_CATEGORY_SLUG && testNumber >= 1 && testNumber <= FREE_TEST_LIMIT
}

/** ¿Puede ver el listado de una categoría? Todos pueden navegar (con candados),
 *  pero solo permiso-b es completamente útil para free. */
export function canBrowseCategory(_user: UserForGate, _categoriaSlug: string): boolean {
  return true
}

/** ¿Está el test bloqueado visualmente (mostrar candado) para este usuario? */
export function isTestLocked(
  user: UserForGate,
  categoriaSlug: string,
  testNumber: number
): boolean {
  return !canAccessTest(user, categoriaSlug, testNumber)
}

// NOTE sobre Competir: el único gate por tier vive en la CREACIÓN de la
// party (POST /api/parties), no al unirse. Si un host PRO crea una party
// con preguntas PRO y comparte el código con un amigo FREE, el amigo se
// une y ve las preguntas PRO igual — es la decisión consciente del host.
// El helper partyHasProQuestions() en src/lib/party.ts queda disponible
// por si se quiere mostrar un badge informativo en el lobby.

/** Quota mensual de tokens IA aplicable. */
export function getEffectiveTokenQuota(user: UserForGate): number {
  return hasFullAccess(user) ? AI_TOKENS_PRO : AI_TOKENS_FREE
}

/** Etiqueta visible del plan, p. ej. para el badge del avatar. */
export function planLabel(user: UserForGate): "ADMIN" | "PRO" | "FREE" | null {
  if (!user) return null
  if (user.role === "ADMIN") return "ADMIN"
  // SUBSCRIBER con acceso PRO efectivo (active, trialing o grace period) → PRO.
  // Consistencia con hasFullAccess: si tiene acceso, el badge lo refleja.
  if (user.role === "SUBSCRIBER" && (isActiveSubscription(user.subscriptionStatus) || isInGracePeriod(user))) return "PRO"
  return "FREE"
}
