"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { requireAdmin } from "@/lib/adminGuard"

type ActionResult = { ok: true } | { ok: false; error: string }

/**
 * Revierte la aprobación de una pregunta IA: pasa de aiApproved=true a
 * aiApproved=false (no la borra — auditoría). Se usa cuando el admin se
 * arrepiente de una pregunta que aprobó antes y quiere quitarla de
 * circulación sin perder el registro.
 *
 * Si en un futuro se necesita reactivar (false → true), el panel
 * /admin/review-questions ya no la verá (busca aiApproved=null). Para
 * eso habría que añadir otra action / vista — pendiente si surge.
 */
export async function discardApprovedQuestionAction(formData: FormData): Promise<ActionResult> {
  await requireAdmin()
  const id = Number(formData.get("id"))
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: "id inválido" }
  }
  // Solo descartamos las que estaban aprobadas — defensivo para que un
  // post manual no pueda manipular preguntas humanas (aiGenerated=false).
  const row = await db.question.findUnique({
    where:  { id },
    select: { aiGenerated: true, aiApproved: true },
  })
  if (!row) return { ok: false, error: "Pregunta no encontrada" }
  if (!row.aiGenerated || row.aiApproved !== true) {
    return { ok: false, error: "Solo se pueden descartar preguntas IA aprobadas" }
  }
  await db.question.update({
    where: { id },
    data:  { aiApproved: false, aiReviewedAt: new Date() },
  })
  revalidatePath("/admin/ai-questions")
  return { ok: true }
}
