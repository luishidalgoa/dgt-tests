"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { CheckCircle2, Wrench, Ban, Loader2, RotateCw, Pencil } from "lucide-react"
import { updateReportStatusAction } from "./actions"
import type { ReportStatus } from "@/lib/questionReports"

interface Props {
  reportId:       number
  questionId:     number
  currentStatus:  ReportStatus
}

/**
 * Botonera de acciones para una QuestionReport: cambiar status a
 * reviewed / fixed / dismissed (o devolver a pending si se cerró por error).
 * Llama a la server action updateReportStatusAction y muestra toast.
 *
 * Conexión con /admin/questions/[id]/edit:
 *   - Botón "Editar pregunta" siempre visible (lleva al editor en otra tab).
 *   - "Marcar fixed" navega automáticamente al editor de la pregunta tras
 *     marcar — porque "fixed" implica que el admin va a corregirla.
 */
export function ReportActions({ reportId, questionId, currentStatus }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function update(status: ReportStatus, label: string, opts?: { redirectToEditor?: boolean }) {
    startTransition(async () => {
      const f = new FormData()
      f.set("id",     String(reportId))
      f.set("status", status)
      const res = await updateReportStatusAction(f)
      if (res.ok) {
        toast.success(label)
        if (opts?.redirectToEditor) {
          router.push(`/admin/questions/${questionId}/edit`)
        }
      } else {
        toast.error(res.error)
      }
    })
  }

  // Si ya está cerrada, ofrecemos "Reabrir" + un acceso directo al editor
  // (útil para revisitar la pregunta tras dismiss/fixed por si el admin
  // quiere terminar de pulir).
  if (currentStatus !== "pending") {
    return (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Link
          href={`/admin/questions/${questionId}/edit`}
          className="btn-secondary"
          style={{ padding: "6px 10px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 5 }}
        >
          <Pencil className="h-3.5 w-3.5" />
          Editar pregunta
        </Link>
        <button
          type="button"
          onClick={() => update("pending", "Reabierta")}
          disabled={isPending}
          className="btn-secondary"
          style={{ padding: "6px 10px", fontSize: 12.5 }}
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
          Reabrir
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <Link
        href={`/admin/questions/${questionId}/edit`}
        className="btn-secondary"
        style={{ padding: "6px 10px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 5 }}
      >
        <Pencil className="h-3.5 w-3.5" />
        Editar pregunta
      </Link>
      <button
        type="button"
        onClick={() => update("reviewed", "Marcada como revisada")}
        disabled={isPending}
        className="btn-secondary"
        style={{ padding: "6px 10px", fontSize: 12.5 }}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        Marcar revisado
      </button>
      <button
        type="button"
        onClick={() => update("fixed", "Marcada arreglada — abriendo editor", { redirectToEditor: true })}
        disabled={isPending}
        className="btn-secondary"
        style={{
          padding:    "6px 10px",
          fontSize:   12.5,
          background: "rgba(34, 197, 94, 0.08)",
          color:      "var(--green-d, #15803d)",
          border:     "1px solid rgba(34, 197, 94, 0.3)",
        }}
      >
        <Wrench className="h-3.5 w-3.5" />
        Marcar fixed
      </button>
      <button
        type="button"
        onClick={() => update("dismissed", "Descartada")}
        disabled={isPending}
        className="btn-secondary"
        style={{
          padding:    "6px 10px",
          fontSize:   12.5,
          color:      "var(--slate-600)",
        }}
      >
        <Ban className="h-3.5 w-3.5" />
        Dismiss
      </button>
    </div>
  )
}
