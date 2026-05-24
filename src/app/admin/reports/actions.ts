"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { requireAdmin } from "@/lib/adminGuard"
import { isReportStatus, type ReportStatus } from "@/lib/questionReports"

type ActionResult = { ok: true } | { ok: false; error: string }
type BulkResult   = { ok: true; count: number } | { ok: false; error: string }

/**
 * Cambia el status de una QuestionReport. El admin es el único que
 * puede tocarlas; requireAdmin() lanza notFound() si no es ADMIN.
 *
 * El status válido viene como string del formData (FormData solo envía
 * texto). Lo validamos contra `isReportStatus` antes de tocar BBDD.
 *
 * `reviewedAt` se rellena al pasar de pending a cualquier estado final
 * (reviewed/fixed/dismissed). Si vuelve a pending (caso raro), lo
 * dejamos a NULL para que la lista vuelva a destacarla como nueva.
 */
export async function updateReportStatusAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin()
  const id = Number(formData.get("id"))
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: "id inválido" }
  }
  const rawStatus = String(formData.get("status") ?? "")
  if (!isReportStatus(rawStatus)) {
    return { ok: false, error: `status '${rawStatus}' no válido` }
  }
  const status: ReportStatus = rawStatus
  await db.questionReport.update({
    where: { id },
    data:  {
      status,
      reviewedAt: status === "pending" ? null : new Date(),
      reviewedBy: status === "pending" ? null : admin.id,
    },
  })
  revalidatePath("/admin/reports")
  revalidatePath("/admin")
  return { ok: true }
}

/**
 * Aplica un nuevo status a TODAS las incidencias de una pregunta que
 * estén actualmente en `currentStatus`. Pensado para el flujo del
 * dashboard agrupado: el admin ve una card por pregunta con N reports
 * acumulados, y al pulsar (p.ej.) "Marcar fixed" cierra los N a la vez.
 *
 * `currentStatus` permite que la acción sea idempotente respecto al
 * filtro mostrado: si la card está en la pestaña "Pendiente", solo
 * cerramos los pending — no tocamos los que ya estaban revisados o
 * fixed por otro flujo.
 */
export async function bulkUpdateReportsForQuestionAction(formData: FormData): Promise<BulkResult> {
  const admin = await requireAdmin()

  const questionId = Number(formData.get("questionId"))
  if (!Number.isInteger(questionId) || questionId <= 0) {
    return { ok: false, error: "questionId inválido" }
  }
  const rawCurrent = String(formData.get("currentStatus") ?? "")
  const rawNext    = String(formData.get("nextStatus") ?? "")
  if (!isReportStatus(rawCurrent)) return { ok: false, error: `currentStatus '${rawCurrent}' no válido` }
  if (!isReportStatus(rawNext))    return { ok: false, error: `nextStatus '${rawNext}' no válido` }
  const currentStatus: ReportStatus = rawCurrent
  const nextStatus:    ReportStatus = rawNext

  const { count } = await db.questionReport.updateMany({
    where: { questionId, status: currentStatus },
    data:  {
      status:     nextStatus,
      reviewedAt: nextStatus === "pending" ? null : new Date(),
      reviewedBy: nextStatus === "pending" ? null : admin.id,
    },
  })

  revalidatePath("/admin/reports")
  revalidatePath("/admin")
  return { ok: true, count }
}
