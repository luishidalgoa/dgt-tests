import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import {
  COMMENT_MAX_LENGTH,
  REPORT_TYPE_VALUES,
} from "@/lib/questionReports"

/**
 * POST /api/questions/[id]/report
 *
 * Crea una incidencia (QuestionReport) sobre la pregunta indicada.
 *
 * Acceso:
 *   - User logueado → userId se rellena con su id; guestEmail se ignora.
 *   - Guest         → userId queda NULL; guestEmail es opcional.
 *
 * El reporte entra con status="pending". Un admin lo revisa después
 * desde /admin/reports y lo marca como reviewed/fixed/dismissed.
 */
const reportSchema = z.object({
  type:       z.enum(REPORT_TYPE_VALUES as readonly [string, ...string[]]),
  comment:    z.string().trim().max(COMMENT_MAX_LENGTH).optional(),
  guestEmail: z.string().trim().email().max(254).optional().or(z.literal("")),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const questionId = Number(id)
  if (!Number.isInteger(questionId) || questionId <= 0) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  const parsed = reportSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 })
  }

  const question = await db.question.findUnique({
    where:  { id: questionId },
    select: { id: true },
  })
  if (!question) {
    return NextResponse.json({ error: "Pregunta no encontrada" }, { status: 404 })
  }

  const user = await getCurrentUser()
  const comment    = parsed.data.comment?.trim() || null
  const guestEmail = !user && parsed.data.guestEmail
    ? parsed.data.guestEmail.trim() || null
    : null

  await db.questionReport.create({
    data: {
      questionId,
      userId:     user?.id ?? null,
      guestEmail,
      type:       parsed.data.type,
      comment,
    },
  })

  return NextResponse.json({ ok: true }, { status: 201 })
}
