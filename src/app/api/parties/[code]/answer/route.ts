import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { getPartyMembership } from "@/lib/party-me"

const schema = z.object({
  questionId:       z.number().int(),
  selectedOptionId: z.number().int().nullable(),
  timeMs:           z.number().int().min(0).max(5 * 60_000),  // tope 5 min por seguridad
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const party = await db.party.findUnique({ where: { code } })
  if (!party) return NextResponse.json({ error: "Party no encontrada" }, { status: 404 })
  if (party.status !== "playing") {
    return NextResponse.json({ error: "La party no está en juego" }, { status: 409 })
  }

  const me = await getPartyMembership(party.id)
  if (!me) return NextResponse.json({ error: "No estás unido" }, { status: 403 })

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
  }

  // Validar que la pregunta pertenece a la party
  const questionIds: number[] = JSON.parse(party.questionIds)
  if (!questionIds.includes(parsed.data.questionId)) {
    return NextResponse.json({ error: "Pregunta no pertenece a la party" }, { status: 400 })
  }

  // Buscar la opción correcta
  const correctOption = await db.option.findFirst({
    where: { questionId: parsed.data.questionId, isCorrect: true },
    select: { id: true },
  })
  const isCorrect =
    parsed.data.selectedOptionId !== null &&
    correctOption?.id === parsed.data.selectedOptionId

  // Evitar duplicados: si ya respondió, ignorar
  const existing = await db.partyAnswer.findFirst({
    where: { partyPlayerId: me.id, questionId: parsed.data.questionId },
  })
  if (existing) {
    return NextResponse.json({ ok: true, alreadyAnswered: true })
  }

  await db.partyAnswer.create({
    data: {
      partyPlayerId:    me.id,
      questionId:       parsed.data.questionId,
      selectedOptionId: parsed.data.selectedOptionId,
      isCorrect,
      timeMs:           parsed.data.timeMs,
    },
  })

  return NextResponse.json({ ok: true, isCorrect })
}
