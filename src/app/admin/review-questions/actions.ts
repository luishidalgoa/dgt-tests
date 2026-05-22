"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { db } from "@/lib/db"
import { requireAdmin } from "@/lib/adminGuard"

type ActionResult = { ok: true } | { ok: false; error: string }

/**
 * Aprueba una pregunta IA-generada. Pasa a ser visible a los usuarios.
 */
export async function approveQuestionAction(formData: FormData): Promise<ActionResult> {
  await requireAdmin()
  const id = Number(formData.get("id"))
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: "id inválido" }
  }
  await db.question.update({
    where: { id },
    data:  { aiApproved: true, aiReviewedAt: new Date() },
  })
  revalidatePath("/admin/review-questions")
  return { ok: true }
}

/**
 * Descarta una pregunta IA-generada. NO se borra (auditoría), pero
 * deja de aparecer al usuario. El admin puede des-descartarla luego
 * editando si fuera necesario (no implementado en MVP).
 */
export async function discardQuestionAction(formData: FormData): Promise<ActionResult> {
  await requireAdmin()
  const id = Number(formData.get("id"))
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: "id inválido" }
  }
  await db.question.update({
    where: { id },
    data:  { aiApproved: false, aiReviewedAt: new Date() },
  })
  revalidatePath("/admin/review-questions")
  return { ok: true }
}

const editSchema = z.object({
  id:          z.number().int().positive(),
  enunciado:   z.string().min(10),
  explicacion: z.string().min(10),
  // Las opciones llegan serializadas como JSON en formData porque un
  // form HTML no maneja bien arrays anidados.
  optionsJson: z.string().min(2),
})

const optionSchema = z.object({
  id:        z.number().int().positive(),
  texto:     z.string().min(1),
  isCorrect: z.boolean(),
})

/**
 * Edita enunciado, explicación y opciones de una pregunta pendiente.
 * NO la aprueba — el admin debe pulsar "Aprobar" después si la quiere
 * activar (o "Descartar" si no). Esto permite editar primero, luego
 * aprobar tranquilo.
 */
export async function editQuestionAction(formData: FormData): Promise<ActionResult> {
  await requireAdmin()
  const parsed = editSchema.safeParse({
    id:          Number(formData.get("id")),
    enunciado:   String(formData.get("enunciado") ?? ""),
    explicacion: String(formData.get("explicacion") ?? ""),
    optionsJson: String(formData.get("optionsJson") ?? ""),
  })
  if (!parsed.success) {
    return { ok: false, error: "Payload inválido" }
  }
  let opts: unknown
  try { opts = JSON.parse(parsed.data.optionsJson) }
  catch { return { ok: false, error: "optionsJson no es JSON" } }
  if (!Array.isArray(opts)) return { ok: false, error: "options debe ser array" }

  const validated: { id: number; texto: string; isCorrect: boolean }[] = []
  for (const o of opts) {
    const r = optionSchema.safeParse(o)
    if (!r.success) return { ok: false, error: `opción inválida: ${r.error.message}` }
    validated.push(r.data)
  }
  // Exactamente 1 correcta
  if (validated.filter((o) => o.isCorrect).length !== 1) {
    return { ok: false, error: "Debe haber exactamente 1 opción correcta" }
  }

  // Actualizar en transacción
  await db.$transaction(async (tx) => {
    await tx.question.update({
      where: { id: parsed.data.id },
      data:  {
        enunciado:   parsed.data.enunciado,
        explicacion: parsed.data.explicacion,
      },
    })
    for (const o of validated) {
      await tx.option.update({
        where: { id: o.id },
        data:  { texto: o.texto, isCorrect: o.isCorrect },
      })
    }
  })
  revalidatePath("/admin/review-questions")
  return { ok: true }
}
