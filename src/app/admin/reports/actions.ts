"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { requireAdmin } from "@/lib/adminGuard"
import { isReportStatus, type ReportStatus } from "@/lib/questionReports"

type ActionResult = { ok: true } | { ok: false; error: string }

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
