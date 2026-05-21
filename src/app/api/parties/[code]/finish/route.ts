import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getPartyMembership } from "@/lib/party-me"

/**
 * Marca al jugador como finished. Si TODOS los jugadores han acabado,
 * marca también la party como "finished".
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const party = await db.party.findUnique({
    where: { code },
    include: { players: true },
  })
  if (!party) return NextResponse.json({ error: "Party no encontrada" }, { status: 404 })

  const me = await getPartyMembership(party.id)
  if (!me) return NextResponse.json({ error: "No estás unido" }, { status: 403 })

  await db.partyPlayer.update({
    where: { id: me.id },
    data:  { finishedAt: new Date() },
  })

  // ¿Todos terminaron?
  const players = await db.partyPlayer.findMany({ where: { partyId: party.id } })
  const allDone = players.every((p) => p.finishedAt !== null)
  if (allDone && party.status !== "finished") {
    await db.party.update({
      where: { id: party.id },
      data:  { status: "finished", finishedAt: new Date() },
    })
  }

  return NextResponse.json({ ok: true })
}
