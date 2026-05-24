"use client"

import { useState } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Loader2 } from "lucide-react"
import {
  COMMENT_MAX_LENGTH,
  REPORT_TYPES,
  type ReportType,
} from "@/lib/questionReports"

interface Props {
  questionId: number
  /**
   * true cuando el visitante no está logueado: mostramos un input email
   * opcional para que el admin pueda contactar de vuelta si hace falta.
   * Si es false (logueado), el userId se toma de la sesión en el server.
   */
  isGuest?: boolean
  /**
   * Variante visual del trigger:
   *  - "icon"  : sólo el ⚠ pequeño + tooltip (default — para usar al lado
   *              del enunciado sin romper el layout).
   *  - "text"  : icono + "Reportar incidencia".
   */
  variant?: "icon" | "text"
}

/**
 * Botón discreto "Reportar incidencia" sobre una pregunta concreta.
 *
 * Click → modal con tipo (select), comentario (textarea, opcional pero
 * recomendado), email opcional para guests. Submit → POST al endpoint
 * /api/questions/:id/report, que crea la incidencia en BBDD.
 *
 * Mostramos toast de éxito y cerramos el modal; los errores quedan en
 * el form con un mensaje rojo en lugar de toast (el usuario sigue
 * viendo el form y puede corregir/reintentar sin perder el texto).
 *
 * Filosofía UX: el botón es DELIBERADAMENTE discreto — no queremos
 * incentivar reports espurios. La gente que de verdad encuentra una
 * errata lo verá y lo usará; los demás ni siquiera lo notarán.
 */
export function QuestionReportButton({ questionId, isGuest = false, variant = "icon" }: Props) {
  const [open, setOpen]         = useState(false)
  const [type, setType]         = useState<ReportType>(REPORT_TYPES[0].value)
  const [comment, setComment]   = useState("")
  const [email, setEmail]       = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]       = useState<string | null>(null)

  function resetForm() {
    setType(REPORT_TYPES[0].value)
    setComment("")
    setEmail("")
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = { type }
      if (comment.trim())            payload.comment = comment.trim()
      if (isGuest && email.trim())   payload.guestEmail = email.trim()
      const res = await fetch(`/api/questions/${questionId}/report`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      toast.success("Gracias por reportar — lo revisamos en breve", {
        duration: 5000,
      })
      setOpen(false)
      resetForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al enviar el reporte")
    } finally {
      setSubmitting(false)
    }
  }

  const triggerLabel = variant === "text" ? "Reportar incidencia" : null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) resetForm()
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          title="Reportar una incidencia en esta pregunta"
          aria-label="Reportar incidencia"
          style={{
            display:      "inline-flex",
            alignItems:   "center",
            gap:          variant === "text" ? 6 : 0,
            padding:      variant === "text" ? "6px 10px" : 4,
            border:       variant === "text" ? "1px solid var(--slate-200)" : "none",
            background:   "transparent",
            color:        "var(--slate-400)",
            borderRadius: 8,
            fontSize:     12.5,
            fontWeight:   600,
            cursor:       "pointer",
            transition:   "color 0.15s, background 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--amber-d, #92400e)"
            if (variant === "text") {
              e.currentTarget.style.background = "rgba(245, 158, 11, 0.08)"
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--slate-400)"
            if (variant === "text") {
              e.currentTarget.style.background = "transparent"
            }
          }}
        >
          <AlertTriangle className="h-4 w-4" />
          {triggerLabel}
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reportar incidencia</DialogTitle>
          <DialogDescription>
            Cuéntanos qué falla en esta pregunta. Revisamos todos los reportes manualmente.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="report-type" style={{ fontSize: 13, fontWeight: 600, color: "var(--slate-700)" }}>
              Tipo de incidencia
            </label>
            <select
              id="report-type"
              required
              value={type}
              onChange={(e) => setType(e.target.value as ReportType)}
              style={{
                padding:      "8px 10px",
                borderRadius: 8,
                border:       "1px solid var(--slate-200)",
                background:   "#fff",
                fontSize:     14,
              }}
            >
              {REPORT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="report-comment" style={{ fontSize: 13, fontWeight: 600, color: "var(--slate-700)" }}>
              Comentario{" "}
              <span style={{ fontWeight: 400, color: "var(--slate-500)" }}>
                (opcional pero recomendado)
              </span>
            </label>
            <textarea
              id="report-comment"
              maxLength={COMMENT_MAX_LENGTH}
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="¿Qué falla exactamente? Cualquier detalle ayuda."
              style={{
                padding:      "8px 10px",
                borderRadius: 8,
                border:       "1px solid var(--slate-200)",
                background:   "#fff",
                fontSize:     14,
                resize:       "vertical",
                minHeight:    80,
                fontFamily:   "inherit",
              }}
            />
            <div style={{ fontSize: 11, color: "var(--slate-400)", textAlign: "right" }}>
              {comment.length} / {COMMENT_MAX_LENGTH}
            </div>
          </div>

          {isGuest && (
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor="report-email" style={{ fontSize: 13, fontWeight: 600, color: "var(--slate-700)" }}>
                Email de contacto{" "}
                <span style={{ fontWeight: 400, color: "var(--slate-500)" }}>(opcional)</span>
              </label>
              <input
                id="report-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                style={{
                  padding:      "8px 10px",
                  borderRadius: 8,
                  border:       "1px solid var(--slate-200)",
                  background:   "#fff",
                  fontSize:     14,
                  fontFamily:   "inherit",
                }}
              />
            </div>
          )}

          {error && (
            <div
              role="alert"
              style={{
                padding:      "8px 12px",
                borderRadius: 8,
                background:   "rgba(239, 68, 68, 0.08)",
                border:       "1px solid rgba(239, 68, 68, 0.3)",
                color:        "var(--red-600)",
                fontSize:     13,
              }}
            >
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Enviar reporte
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
