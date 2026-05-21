import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getPartyMembership } from "@/lib/party-me"
import { scoreForAnswer, type PartyState } from "@/lib/party"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params

  const party = await db.party.findUnique({
    where: { code },
    include: {
      host:     true,
      category: true,
      players: {
        orderBy: { joinedAt: "asc" },
        include: {
          user:    true,
          answers: { select: { isCorrect: true, timeMs: true } },
        },
      },
    },
  })

  if (!party) return NextResponse.json({ error: "Party no encontrada" }, { status: 404 })

  const me = await getPartyMembership(party.id)

  const players = party.players.map((p) => {
    const name = p.user ? (p.user.displayName ?? p.user.username) : (p.guestName ?? "Anónimo")
    const score = p.answers.reduce((acc, a) => acc + scoreForAnswer(a.isCorrect, a.timeMs), 0)
    const correctCount = p.answers.filter((a) => a.isCorrect).length
    return {
      id:            p.id,
      name,
      isGuest:       p.userId === null,
      isYou:         me?.id === p.id,
      isHost:        p.userId === party.hostUserId,
      joinedAt:      p.joinedAt.toISOString(),
      answeredCount: p.answers.length,
      isFinished:    p.finishedAt !== null,
      score,
      correctCount,
    }
  })

  const state: PartyState = {
    code:           party.code,
    status:         party.status as PartyState["status"],
    hostUserId:     party.hostUserId,
    hostName:       party.host.displayName ?? party.host.username,
    totalQuestions: party.totalQuestions,
    categoryName:   party.category?.name ?? null,
    startedAt:      party.startedAt?.toISOString() ?? null,
    finishedAt:     party.finishedAt?.toISOString() ?? null,
    players,
  }

  return NextResponse.json(state)
}


// POST → iniciar la party (solo host)
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const party = await db.party.findUnique({ where: { code } })
  if (!party) return NextResponse.json({ error: "Party no encontrada" }, { status: 404 })

  const me = await getPartyMembership(party.id)
  if (!me || me.userId !== party.hostUserId) {
    return NextResponse.json({ error: "Solo el host puede iniciar" }, { status: 403 })
  }
  if (party.status !== "waiting") {
    return NextResponse.json({ error: "La party ya empezó" }, { status: 409 })
  }

  await db.party.update({
    where: { id: party.id },
    data:  { status: "playing", startedAt: new Date() },
  })
  return NextResponse.json({ ok: true })
}
