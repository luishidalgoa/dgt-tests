"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { CheckCircle2, Wrench, Ban, Loader2, RotateCw, Pencil } from "lucide-react"
import { bulkUpdateReportsForQuestionAction } from "./actions"
import type { ReportStatus } from "@/lib/questionReports"

interface Props {
  questionId:    number
  /** Cuántos reports de esta pregunta hay en el filtro actual.
   *  Sirve para el texto del toast ("Cerrados N reports"). */
  groupCount:    number
  currentStatus: ReportStatus
}

/**
 * Acciones bulk sobre todos los reports de UNA pregunta que estén en
 * `currentStatus`. Llama a bulkUpdateReportsForQuestionAction, que
 * usa updateMany internamente.
 *
 * Flujo "Marcar fixed": cierra los N a la vez + redirige al editor de
 * la pregunta — el admin va a corregirla.
 */
export function GroupedReportActions({ questionId, groupCount, currentStatus }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function bulk(nextStatus: ReportStatus, label: string, opts?: { redirectToEditor?: boolean }) {
    startTransition(async () => {
      const f = new FormData()
      f.set("questionId",    String(questionId))
      f.set("currentStatus", currentStatus)
      f.set("nextStatus",    nextStatus)
      const res = await bulkUpdateReportsForQuestionAction(f)
      if (res.ok) {
        const suffix = res.count === 1 ? "incidencia" : "incidencias"
        toast.success(`${label} (${res.count} ${suffix})`)
        if (opts?.redirectToEditor) {
          router.push(`/admin/questions/${questionId}/edit?from=reports`)
        }
      } else {
        toast.error(res.error)
      }
    })
  }

  // Si la card está en estado cerrado (no pending), ofrecemos reabrir.
  if (currentStatus !== "pending") {
    return (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Link
          href={`/admin/questions/${questionId}/edit?from=reports`}
          className="btn-secondary"
          style={btnStyle}
        >
          <Pencil className="h-3.5 w-3.5" />
          Editar pregunta
        </Link>
        <button
          type="button"
          onClick={() => bulk("pending", `Reabiertas ${groupCount === 1 ? "" : "las "}incidencias`)}
          disabled={isPending}
          className="btn-secondary"
          style={btnStyle}
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
          Reabrir {groupCount > 1 ? `(${groupCount})` : ""}
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <Link
        href={`/admin/questions/${questionId}/edit?from=reports`}
        className="btn-secondary"
        style={btnStyle}
      >
        <Pencil className="h-3.5 w-3.5" />
        Editar pregunta
      </Link>
      <button
        type="button"
        onClick={() => bulk("reviewed", "Marcadas como revisadas")}
        disabled={isPending}
        className="btn-secondary"
        style={btnStyle}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        Marcar revisado {groupCount > 1 ? `(${groupCount})` : ""}
      </button>
      <button
        type="button"
        onClick={() => bulk("fixed", "Marcadas arregladas — abriendo editor", { redirectToEditor: true })}
        disabled={isPending}
        className="btn-secondary"
        style={{
          ...btnStyle,
          background: "rgba(34, 197, 94, 0.08)",
          color:      "var(--green-d, #15803d)",
          border:     "1px solid rgba(34, 197, 94, 0.3)",
        }}
      >
        <Wrench className="h-3.5 w-3.5" />
        Marcar fixed {groupCount > 1 ? `(${groupCount})` : ""}
      </button>
      <button
        type="button"
        onClick={() => bulk("dismissed", "Descartadas")}
        disabled={isPending}
        className="btn-secondary"
        style={{ ...btnStyle, color: "var(--slate-600)" }}
      >
        <Ban className="h-3.5 w-3.5" />
        Dismiss {groupCount > 1 ? `(${groupCount})` : ""}
      </button>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding:    "6px 10px",
  fontSize:   12.5,
  display:    "inline-flex",
  alignItems: "center",
  gap:        5,
}
