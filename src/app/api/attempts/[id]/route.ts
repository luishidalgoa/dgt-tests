import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"

/**
 * DELETE /api/attempts/[id]
 *
 * Borra un ExamAttempt y todo lo asociado en cascada (Answer rows,
 * user_ai_paid rows asociadas, etc. — todas las FKs van con
 * onDelete: Cascade).
 *
 * Permitido SOLO a usuarios ADMIN, y solo sobre sus PROPIOS attempts.
 * Un admin no puede borrar attempts de otros users desde aquí — para
 * eso hay scripts (cleanup-orphan-attempts, reset-user-data).
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo el rol ADMIN puede borrar intentos" }, { status: 403 })
  }

  const { id } = await params
  const attemptId = Number.parseInt(id, 10)
  if (!Number.isFinite(attemptId) || attemptId <= 0) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 })
  }

  const attempt = await db.examAttempt.findUnique({
    where:  { id: attemptId },
    select: { id: true, userId: true },
  })
  if (!attempt) {
    return NextResponse.json({ error: "Intento no encontrado" }, { status: 404 })
  }
  if (attempt.userId !== user.id) {
    return NextResponse.json(
      { error: "Solo puedes borrar tus propios intentos" },
      { status: 403 }
    )
  }

  await db.examAttempt.delete({ where: { id: attemptId } })

  return NextResponse.json({ deleted: true, id: attemptId })
}
