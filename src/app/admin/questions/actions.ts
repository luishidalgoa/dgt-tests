"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { db } from "@/lib/db"
import { requireAdmin } from "@/lib/adminGuard"
import { questionToSlug } from "@/lib/questionUrl"
import {
  suggestAnswerForQuestion,
  AIProviderError,
  type AnswerSuggestionResult,
} from "@/lib/ai"

type ActionResult = { ok: true } | { ok: false; error: string }

type SuggestResult =
  | { ok: true;  suggestion: AnswerSuggestionResult }
  | { ok: false; error: string; kind?: "rate_limit" | "misconfigured" | "bad_request" | "server_error" | "unknown" }

const editSchema = z.object({
  id:          z.number().int().positive(),
  enunciado:   z.string().trim().min(10, "El enunciado debe tener al menos 10 caracteres"),
  explicacion: z.string().trim().min(5,  "La explicación debe tener al menos 5 caracteres"),
  codigoTema:  z.string().trim().max(120).nullable(),
  imagen:      z.string().trim().max(255).nullable(),
  // optionsJson: array de { id, texto, isCorrect } serializado a JSON.
  optionsJson: z.string().min(2),
})

const optionSchema = z.object({
  id:        z.number().int().positive(),
  texto:     z.string().trim().min(1, "El texto de la opción no puede estar vacío"),
  isCorrect: z.boolean(),
})

/**
 * Actualiza una pregunta del banco desde /admin/questions/[id]/edit.
 *
 * Reglas:
 *   - requireAdmin (404 si no es ADMIN)
 *   - Exactamente 1 opción correcta
 *   - Setea lastEditedAt / lastEditedBy (audit)
 *   - Borra cualquier AICacheEntry asociada (la explicación cacheada
 *     ya no aplica si cambiaron opciones/enunciado)
 *   - Revalida /preguntas y /preguntas/[categoria]/[slug]
 *
 * El sync a Turso NO es automático: en dev local hay que correr
 * `npm run turso:sync-question -- --id <N>` después; en prod (Vercel)
 * la BBDD ya ES Turso y no hace falta.
 */
export async function updateQuestionAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin()

  const parsed = editSchema.safeParse({
    id:          Number(formData.get("id")),
    enunciado:   String(formData.get("enunciado") ?? ""),
    explicacion: String(formData.get("explicacion") ?? ""),
    codigoTema:  emptyToNull(formData.get("codigoTema")),
    imagen:      emptyToNull(formData.get("imagen")),
    optionsJson: String(formData.get("optionsJson") ?? ""),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") }
  }

  let optsRaw: unknown
  try { optsRaw = JSON.parse(parsed.data.optionsJson) }
  catch { return { ok: false, error: "optionsJson no es JSON válido" } }
  if (!Array.isArray(optsRaw)) return { ok: false, error: "options debe ser un array" }

  const validated: { id: number; texto: string; isCorrect: boolean }[] = []
  for (const o of optsRaw) {
    const r = optionSchema.safeParse(o)
    if (!r.success) return { ok: false, error: `opción inválida: ${r.error.issues.map((i) => i.message).join(", ")}` }
    validated.push(r.data)
  }
  if (validated.filter((o) => o.isCorrect).length !== 1) {
    return { ok: false, error: "Debe haber exactamente 1 opción correcta" }
  }

  // Verificamos que las opciones pertenezcan a la pregunta — defensivo
  // contra payload manipulado que intente editar opciones de otra pregunta.
  const existing = await db.question.findUnique({
    where:   { id: parsed.data.id },
    include: { options: { select: { id: true } } },
  })
  if (!existing) return { ok: false, error: "Pregunta no encontrada" }
  const validOptionIds = new Set(existing.options.map((o) => o.id))
  for (const o of validated) {
    if (!validOptionIds.has(o.id)) {
      return { ok: false, error: `La opción ${o.id} no pertenece a esta pregunta` }
    }
  }

  // Detectamos si hubo cambio en opciones o enunciado — para decidir si
  // invalidamos también el cache IA (que depende de ambos).
  const optionsChanged = await hasOptionChanges(parsed.data.id, validated)
  const enunciadoChanged = existing.enunciado !== parsed.data.enunciado

  await db.$transaction(async (tx) => {
    await tx.question.update({
      where: { id: parsed.data.id },
      data:  {
        enunciado:    parsed.data.enunciado,
        explicacion:  parsed.data.explicacion,
        codigoTema:   parsed.data.codigoTema,
        imagen:       parsed.data.imagen,
        lastEditedAt: new Date(),
        lastEditedBy: admin.id,
      },
    })
    for (const o of validated) {
      await tx.option.update({
        where: { id: o.id },
        data:  { texto: o.texto, isCorrect: o.isCorrect },
      })
    }
  })

  // Si cambiaron opciones o enunciado, el cache IA está desactualizado:
  // la explicación cacheada se generó contra una versión distinta de la
  // pregunta. Lo borramos para que se regenere bajo demanda.
  if (optionsChanged || enunciadoChanged) {
    await db.aICacheEntry.deleteMany({ where: { questionId: parsed.data.id } })
  }

  // Cerrar reports pendientes: si hay incidencias abiertas sobre esta
  // pregunta y el admin acaba de editarla, los marcamos como `fixed`
  // automáticamente con `reviewedBy = admin.id`. El admin puede reabrirlos
  // desde /admin/reports si el cambio no era lo que pedía el reporte.
  const closedReports = await db.questionReport.updateMany({
    where: { questionId: parsed.data.id, status: "pending" },
    data:  { status: "fixed", reviewedAt: new Date(), reviewedBy: admin.id },
  })
  if (closedReports.count > 0) {
    revalidatePath("/admin/reports")
    revalidatePath("/admin")
  }

  // Invalidar las páginas SEO afectadas. La URL canónica depende del
  // enunciado (puede haber cambiado el slug); buscamos la categoria
  // primaria via testQuestions para construir el path.
  revalidatePath("/preguntas")
  const slugInfo = await getCanonicalSlug(parsed.data.id, parsed.data.enunciado)
  if (slugInfo) {
    revalidatePath(`/preguntas/${slugInfo.categoria}/${slugInfo.slug}`)
  }
  revalidatePath("/admin/questions")
  revalidatePath(`/admin/questions/${parsed.data.id}/edit`)

  return { ok: true }
}

function emptyToNull(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  return t.length === 0 ? null : t
}

async function hasOptionChanges(
  questionId: number,
  next: { id: number; texto: string; isCorrect: boolean }[],
): Promise<boolean> {
  const current = await db.option.findMany({
    where:  { questionId },
    select: { id: true, texto: true, isCorrect: true },
  })
  const byId = new Map(current.map((c) => [c.id, c]))
  for (const n of next) {
    const c = byId.get(n.id)
    if (!c) return true
    if (c.texto !== n.texto || c.isCorrect !== n.isCorrect) return true
  }
  return false
}

/**
 * Pide a la IA activa una segunda opinión sobre cuál es la respuesta
 * correcta de una pregunta. NO le mandamos la opción marcada como
 * correcta — queremos que el modelo la deduzca por sí solo bajo la
 * normativa DGT española.
 *
 * Se invoca desde /admin/questions/[id]/edit con un botón "Pedir
 * opinión IA". Sólo admins; no consume cuota de usuario.
 *
 * Si la IA no está configurada o falla, devolvemos `ok:false` con
 * `kind` clasificado para que la UI muestre un mensaje útil.
 */
export async function suggestAnswerAction(questionId: number): Promise<SuggestResult> {
  await requireAdmin()
  if (!Number.isInteger(questionId) || questionId <= 0) {
    return { ok: false, error: "questionId inválido" }
  }

  const question = await db.question.findUnique({
    where:   { id: questionId },
    include: { options: { orderBy: { letra: "asc" } } },
  })
  if (!question) return { ok: false, error: "Pregunta no encontrada" }
  if (question.options.length === 0) {
    return { ok: false, error: "La pregunta no tiene opciones" }
  }

  try {
    const suggestion = await suggestAnswerForQuestion({
      enunciado:          question.enunciado,
      explicacionOficial: question.explicacion || null,
      codigoTema:         question.codigoTema,
      options:            question.options.map((o) => ({ letra: o.letra, texto: o.texto })),
      imagePath:          question.imagen,
    })
    return { ok: true, suggestion }
  } catch (err) {
    if (err instanceof AIProviderError) {
      return { ok: false, error: friendlyErrorMessage(err), kind: err.kind }
    }
    return { ok: false, error: err instanceof Error ? err.message : "Error inesperado" }
  }
}

function friendlyErrorMessage(err: AIProviderError): string {
  switch (err.kind) {
    case "rate_limit":    return "El proveedor IA está saturado o sin cuota — inténtalo en unos minutos."
    case "misconfigured": return "La API key del proveedor IA no es válida — revísala en /admin/secrets."
    case "bad_request":   return "La IA no pudo procesar esta pregunta (posiblemente la imagen)."
    case "server_error":  return "El proveedor IA tuvo un error temporal — reintenta."
    default:              return "Error desconocido del proveedor IA."
  }
}

async function getCanonicalSlug(
  questionId: number,
  enunciado: string,
): Promise<{ categoria: string; slug: string } | null> {
  const q = await db.question.findUnique({
    where: { id: questionId },
    select: {
      testQuestions: {
        take:    1,
        orderBy: { test: { testNumber: "asc" } },
        select:  { test: { select: { category: { select: { slug: true } } } } },
      },
    },
  })
  const categoria = q?.testQuestions[0]?.test.category.slug
  if (!categoria) return null
  return {
    categoria,
    slug: questionToSlug({ id: questionId, enunciado }),
  }
}
