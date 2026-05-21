/**
 * Reglas de acceso del usuario según su rol y estado de suscripción.
 *
 * Hay 3 roles:
 *   - USER:       cuenta gratis. Acceso solo a los 7 primeros tests de
 *                 Permiso B + 10 tokens IA/mes.
 *   - SUBSCRIBER: usuario con suscripción Stripe activa. Acceso total
 *                 + 50 tokens IA/mes.
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
export const AI_TOKENS_PRO  = 50

export type UserForGate = Pick<User, "role" | "subscriptionStatus"> | null

/** El usuario tiene acceso completo (rol ADMIN, o SUBSCRIBER con suscripción activa). */
export function hasFullAccess(user: UserForGate): boolean {
  if (!user) return false
  if (user.role === "ADMIN") return true
  if (user.role === "SUBSCRIBER" && isActiveSubscription(user.subscriptionStatus)) return true
  return false
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

/**
 * ¿Puede el usuario unirse a una party cuyo contenido viene de esta categoría?
 * - PRO/ADMIN: siempre sí
 * - Free/guest: solo si la categoría es la free (permiso-b)
 * - Si la party no tiene categoría asignada (preguntas mezcladas), solo PRO/ADMIN
 */
export function canJoinPartyWithCategory(
  user: UserForGate,
  categoriaSlug: string | null | undefined
): boolean {
  if (hasFullAccess(user)) return true
  return categoriaSlug === FREE_CATEGORY_SLUG
}

/** Quota mensual de tokens IA aplicable. */
export function getEffectiveTokenQuota(user: UserForGate): number {
  return hasFullAccess(user) ? AI_TOKENS_PRO : AI_TOKENS_FREE
}

/** Etiqueta visible del plan, p. ej. para el badge del avatar. */
export function planLabel(user: UserForGate): "ADMIN" | "PRO" | "FREE" | null {
  if (!user) return null
  if (user.role === "ADMIN") return "ADMIN"
  if (user.role === "SUBSCRIBER" && isActiveSubscription(user.subscriptionStatus)) return "PRO"
  return "FREE"
}
