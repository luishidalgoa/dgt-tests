import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { z } from "zod"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { canJoinPartyWithCategory } from "@/lib/permissions"
import { MAX_PLAYERS_PER_PARTY, PARTY_COOKIE_PREFIX, newGuestToken } from "@/lib/party"

const schema = z.object({
  guestName: z.string().trim().min(1).max(20).optional(),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params

  const party = await db.party.findUnique({
    where: { code },
    include: {
      players:  true,
      category: { select: { slug: true } },
    },
  })
  if (!party) {
    return NextResponse.json({ error: "Party no encontrada" }, { status: 404 })
  }
  if (party.status !== "waiting") {
    return NextResponse.json({ error: "La party ya ha empezado" }, { status: 409 })
  }
  if (party.players.length >= MAX_PLAYERS_PER_PARTY) {
    return NextResponse.json({ error: "La party está llena" }, { status: 409 })
  }

  const user = await getCurrentUser()

  // ── Gating por plan: solo PRO/admin puede unirse a partys con contenido
  //    no-free (todas excepto permiso-b). Free/guest solo permiso-b. ────
  if (!canJoinPartyWithCategory(user, party.category?.slug ?? null)) {
    return NextResponse.json(
      {
        error: user
          ? "Esta party usa contenido PRO. Suscríbete para unirte."
          : "Esta party usa contenido PRO. Crea cuenta y suscríbete.",
      },
      { status: 403 }
    )
  }

  // ── Caso 1: usuario logueado ──────────────────────────────────────────
  if (user) {
    const already = party.players.find((p) => p.userId === user.id)
    if (already) return NextResponse.json({ ok: true, playerId: already.id })

    const player = await db.partyPlayer.create({
      data: { partyId: party.id, userId: user.id },
    })
    return NextResponse.json({ ok: true, playerId: player.id })
  }

  // ── Caso 2: guest ─────────────────────────────────────────────────────
  const store = await cookies()

  // ¿Ya tiene token para esta party?
  const existingToken = store.get(PARTY_COOKIE_PREFIX + party.id)?.value
  if (existingToken) {
    const existingPlayer = party.players.find((p) => p.guestToken === existingToken)
    if (existingPlayer) return NextResponse.json({ ok: true, playerId: existingPlayer.id })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success || !parsed.data.guestName) {
    return NextResponse.json({ error: "Falta tu nombre" }, { status: 400 })
  }

  const guestToken = newGuestToken()
  const player = await db.partyPlayer.create({
    data: {
      partyId:    party.id,
      guestName:  parsed.data.guestName,
      guestToken,
    },
  })

  store.set({
    name:     PARTY_COOKIE_PREFIX + party.id,
    value:    guestToken,
    httpOnly: true,
    sameSite: "lax",
    path:     "/",
    maxAge:   60 * 60 * 24 * 3,   // 3 días
  })

  return NextResponse.json({ ok: true, playerId: player.id })
}
