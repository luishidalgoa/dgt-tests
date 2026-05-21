/**
 * Helpers de identificación dentro de una party (server-side).
 * Un jugador puede ser:
 *   - Usuario logueado (cookie de sesión iron-session)
 *   - Guest (cookie party_token_<partyId> con el guestToken)
 */

import { cookies } from "next/headers"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { PARTY_COOKIE_PREFIX } from "@/lib/party"

export interface PartyMember {
  id:         number
  partyId:    number
  userId:     number | null
  guestName:  string | null
  guestToken: string | null
}

/**
 * Resuelve qué PartyPlayer es el "yo" dentro de una party.
 * Devuelve null si el usuario no está unido.
 */
export async function getPartyMembership(partyId: number): Promise<PartyMember | null> {
  // ¿Es usuario logueado?
  const user = await getCurrentUser()
  if (user) {
    const p = await db.partyPlayer.findFirst({
      where: { partyId, userId: user.id },
    })
    if (p) return p
  }

  // ¿Es guest con token en cookie?
  const store = await cookies()
  const token = store.get(PARTY_COOKIE_PREFIX + partyId)?.value
  if (token) {
    const p = await db.partyPlayer.findFirst({
      where: { partyId, guestToken: token },
    })
    if (p) return p
  }

  return null
}
