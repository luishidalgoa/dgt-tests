"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { CheckCircle2, Wrench, Ban, Loader2, RotateCw } from "lucide-react"
import { updateReportStatusAction } from "./actions"
import type { ReportStatus } from "@/lib/questionReports"

interface Props {
  reportId:       number
  currentStatus:  ReportStatus
}

/**
 * Botonera de acciones para una QuestionReport: cambiar status a
 * reviewed / fixed / dismissed (o devolver a pending si se cerró por error).
 * Llama a la server action updateReportStatusAction y muestra toast.
 *
 * El "Marcar fixed" no enlaza directamente al editor — esta versión es
 * agnóstica de si existe el panel /admin/questions/[id]/edit. Si ese
 * panel llega, se puede añadir aquí un <Link> al lado del botón.
 */
export function ReportActions({ reportId, currentStatus }: Props) {
  const [isPending, startTransition] = useTransition()

  function update(status: ReportStatus, label: string) {
    startTransition(async () => {
      const f = new FormData()
      f.set("id",     String(reportId))
      f.set("status", status)
      const res = await updateReportStatusAction(f)
      if (res.ok) toast.success(label)
      else        toast.error(res.error)
    })
  }

  // Si ya está cerrada, ofrecemos sólo "Reabrir → pending".
  if (currentStatus !== "pending") {
    return (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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
        onClick={() => update("fixed", "Marcada como arreglada")}
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
