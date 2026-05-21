import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getPartyMembership } from "@/lib/party-me"

/**
 * Devuelve las preguntas de la party (sin marcar la correcta).
 * Requiere ser participante.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const party = await db.party.findUnique({ where: { code } })
  if (!party) return NextResponse.json({ error: "Party no encontrada" }, { status: 404 })

  const me = await getPartyMembership(party.id)
  if (!me) return NextResponse.json({ error: "No estás unido a esta party" }, { status: 403 })

  if (party.status === "waiting") {
    return NextResponse.json({ error: "La party aún no ha empezado" }, { status: 409 })
  }

  const questionIds: number[] = JSON.parse(party.questionIds)
  const questions = await db.question.findMany({
    where: { id: { in: questionIds } },
    include: { options: { orderBy: { letra: "asc" } } },
  })

  // Ordenar según el orden de questionIds
  const orderMap = new Map(questionIds.map((id, i) => [id, i]))
  questions.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0))

  // Marcar al jugador como "started" si no lo estaba
  if (!me.id) return NextResponse.json({ error: "Internal" }, { status: 500 })
  await db.partyPlayer.updateMany({
    where: { id: me.id, startedAt: null },
    data:  { startedAt: new Date() },
  })

  return NextResponse.json({
    totalQuestions: party.totalQuestions,
    questions: questions.map((q) => ({
      id:         q.id,
      externalId: q.externalId,
      enunciado:  q.enunciado,
      imagen:     q.imagen,
      codigoTema: q.codigoTema,
      options:    q.options.map((o) => ({ id: o.id, letra: o.letra, texto: o.texto })),
    })),
  })
}
