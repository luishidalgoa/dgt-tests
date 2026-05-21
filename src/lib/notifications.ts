/**
 * Sistema de notificaciones one-time.
 *
 * Cada usuario tiene un campo `acknowledgments` (JSON String[]) con los ids
 * de las notificaciones que ya ha visto. Al cargar el dashboard buscamos la
 * PRIMERA notificación elegible y no acked, y la renderizamos en un modal.
 *
 * Para añadir una nueva (p.ej. actualización de términos en 2026-Q2):
 *   1. Añade aquí abajo una entry con un id ÚNICO (p.ej. "terms-2026-q2")
 *   2. Crea el componente del modal con esa key en NotificationModalSwitch
 *   3. Deploy. Todos los usuarios la verán la próxima vez que entren.
 *
 * No reutilizar ids: los antiguos ids quedan en los `acknowledgments` de
 * los usuarios para siempre.
 */

import type { User } from "@prisma/client"
import { isAdmin } from "@/lib/permissions"

export interface NotificationConfig {
  id:       string
  /** Predicado que decide si este usuario es elegible para verlo. */
  eligible: (user: User) => boolean
}

export const NOTIFICATIONS: readonly NotificationConfig[] = [
  {
    id: "welcome-v1",
    // Admins no necesitan ver el modal de "elige tu plan"
    eligible: (u) => !isAdmin(u),
  },
  // Ejemplos para el futuro:
  // {
  //   id: "terms-update-2026-q2",
  //   eligible: () => true,
  // },
  // {
  //   id: "new-feature-flashcards",
  //   eligible: (u) => u.role !== "ADMIN",
  // },
] as const

export type NotificationId = (typeof NOTIFICATIONS)[number]["id"]

function parseAcks(json: string): string[] {
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

/** ¿Ha visto el usuario esta notificación? */
export function hasAcknowledged(user: User, id: string): boolean {
  return parseAcks(user.acknowledgments).includes(id)
}

/**
 * Devuelve la primera notificación pendiente para el usuario, o null si
 * no hay ninguna que mostrar.
 */
export function firstPendingNotification(user: User): NotificationConfig | null {
  const acks = new Set(parseAcks(user.acknowledgments))
  for (const n of NOTIFICATIONS) {
    if (acks.has(n.id)) continue
    if (!n.eligible(user)) continue
    return n
  }
  return null
}

/** Devuelve una copia del array con el nuevo id añadido (sin duplicar). */
export function addAcknowledgment(currentJson: string, id: string): string {
  const arr = parseAcks(currentJson)
  if (!arr.includes(id)) arr.push(id)
  return JSON.stringify(arr)
}
