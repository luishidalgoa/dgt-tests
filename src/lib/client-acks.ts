/**
 * Doble capa de "notificaciones ya vistas" en cliente.
 *
 * - Capa autoritativa: User.acknowledgments en servidor (sirve para
 *   sincronizar entre dispositivos).
 * - Capa local (este módulo): localStorage `dgt:user-acks`. Sirve como
 *   defensa para que la notificación NO vuelva a aparecer aunque el POST
 *   al servidor falle (Prisma stale, red mala, tab cerrada, etc.).
 *
 * El componente que pinta la notificación filtra por AMBAS capas.
 */

const KEY = "dgt:user-acks"

export function getLocalAcks(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

export function isLocallyAcked(id: string): boolean {
  return getLocalAcks().includes(id)
}

export function addLocalAck(id: string): void {
  if (typeof window === "undefined") return
  try {
    const acks = getLocalAcks()
    if (acks.includes(id)) return
    acks.push(id)
    window.localStorage.setItem(KEY, JSON.stringify(acks))
  } catch {
    // ignore
  }
}

/**
 * Marca la notificación como vista en local Y en servidor.
 *
 * - localStorage se actualiza ANTES (síncrono, instantáneo).
 * - El POST usa keepalive para sobrevivir aunque se cierre la pestaña.
 * - Si el POST falla, no rompe: el localStorage ya evita el re-show.
 *
 * Devuelve true si el POST al servidor tuvo éxito.
 */
export async function ackNotification(id: string): Promise<boolean> {
  addLocalAck(id)
  try {
    const res = await fetch("/api/users/me/ack", {
      method:    "POST",
      headers:   { "Content-Type": "application/json" },
      body:      JSON.stringify({ key: id }),
      keepalive: true,
    })
    return res.ok
  } catch {
    return false
  }
}
