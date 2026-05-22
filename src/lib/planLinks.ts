/**
 * Decide a qué URL apunta el badge de plan en el navbar (si apunta a
 * alguna). El badge solo es clicable para el rol ADMIN (lleva a /admin)
 * y para FREE (lleva a /upgrade). PRO no necesita destino — su gestión
 * está dentro de /settings.
 *
 * Helper puro para que sea testeable sin renderizar React.
 */
import type { ReactNode } from "react"

export type Plan = "FREE" | "PRO" | "ADMIN"

/** Devuelve la URL destino del badge, o null si no debe ser clicable. */
export function getPlanHref(plan: Plan): string | null {
  if (plan === "ADMIN") return "/admin"
  if (plan === "FREE")  return "/upgrade"
  return null   // PRO no es clicable
}

export interface BadgeMeta {
  href:  string | null
  /** Texto del tooltip / aria-label. */
  title: string
}

/** Texto del tooltip por plan. Centralizado para que el badge no duplique. */
export function getPlanBadgeMeta(plan: Plan): BadgeMeta {
  const href = getPlanHref(plan)
  if (plan === "ADMIN") {
    return { href, title: "Acceso total · sin facturación · ir al panel admin" }
  }
  if (plan === "PRO") {
    return { href, title: "Suscripción PRO activa" }
  }
  // FREE
  return { href, title: "Plan gratuito — pulsa para mejorar" }
}

// Re-export para que React no necesite importar el tipo aparte.
export type { ReactNode }
