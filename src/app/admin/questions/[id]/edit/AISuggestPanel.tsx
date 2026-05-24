"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Sparkles, Loader2, BookOpen, AlertCircle, CheckCircle2 } from "lucide-react"
import { suggestAnswerAction } from "../../actions"
import type { AnswerSuggestionResult } from "@/lib/ai"

interface Props {
  questionId: number
  /**
   * Letra actualmente marcada como correcta en el form (lo que el admin
   * está editando). Si la sugerencia IA coincide → badge verde;
   * si difiere → badge ámbar de alerta.
   */
  currentCorrectLetra: string | null
}

/**
 * Panel "Segunda opinión IA" en /admin/questions/[id]/edit.
 *
 * Botón → server action que llama al provider IA activo (Gemini/Groq)
 * con prompt orientado a normativa DGT española. Renderiza la letra
 * sugerida, la confianza, el razonamiento y la base normativa.
 *
 * No consume cuota del usuario (es admin-only). No persiste — cada
 * llamada es una opinión fresca.
 */
export function AISuggestPanel({ questionId, currentCorrectLetra }: Props) {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<AnswerSuggestionResult | null>(null)
  const [error, setError]   = useState<string | null>(null)

  function handleClick() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await suggestAnswerAction(questionId)
        if (res.ok) {
          setResult(res.suggestion)
        } else {
          setError(res.error)
          setResult(null)
          toast.error(res.error)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error inesperado"
        setError(msg)
        setResult(null)
        toast.error(msg)
      }
    })
  }

  const suggestion = result
  const agrees = suggestion && currentCorrectLetra
    ? suggestion.suggestedLetra.toUpperCase() === currentCorrectLetra.toUpperCase()
    : null

  return (
    <div
      className="card-soft"
      style={{
        padding:      16,
        marginBottom: 16,
        background:   "rgba(168, 85, 247, 0.05)",
        border:       "1px solid rgba(168, 85, 247, 0.25)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: suggestion || error ? 12 : 0, flexWrap: "wrap" }}>
        <Sparkles className="h-4 w-4" style={{ color: "rgb(126, 34, 206)" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "rgb(126, 34, 206)" }}>
            Segunda opinión IA
          </div>
          <div style={{ fontSize: 11.5, color: "var(--slate-500)", marginTop: 2 }}>
            La IA analiza la pregunta bajo la normativa DGT española (sin saber cuál marcaste como correcta).
            Útil cuando dudas si tu corrección es la buena.
          </div>
        </div>
        <button
          type="button"
          onClick={handleClick}
          disabled={isPending}
          style={{
            display:      "inline-flex",
            alignItems:   "center",
            gap:          6,
            padding:      "8px 14px",
            borderRadius: 8,
            border:       0,
            background:   "rgb(126, 34, 206)",
            color:        "white",
            fontWeight:   700,
            fontSize:     13,
            cursor:       isPending ? "wait" : "pointer",
            opacity:      isPending ? 0.7 : 1,
            whiteSpace:   "nowrap",
          }}
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {isPending ? "Consultando…" : suggestion ? "Reintentar" : "Pedir opinión IA"}
        </button>
      </div>

      {error && !isPending && (
        <div
          role="alert"
          style={{
            padding:      "10px 12px",
            borderRadius: 8,
            background:   "rgba(239, 68, 68, 0.08)",
            border:       "1px solid rgba(239, 68, 68, 0.3)",
            color:        "var(--red-600)",
            fontSize:     12.5,
            display:      "flex",
            alignItems:   "center",
            gap:          8,
          }}
        >
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {suggestion && !error && (
        <div
          style={{
            padding:      "12px 14px",
            borderRadius: 10,
            background:   "#fff",
            border:       "1px solid rgba(168, 85, 247, 0.25)",
            display:      "grid",
            gap:          10,
          }}
        >
          {/* Letra sugerida + confianza + agreement */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--slate-500)", fontWeight: 600 }}>
              Letra sugerida:
            </span>
            <span
              className="font-mono-tabular"
              style={{
                display:      "inline-flex",
                alignItems:   "center",
                justifyContent: "center",
                width:        32,
                height:       32,
                borderRadius: "50%",
                background:   agrees === true
                  ? "var(--green)"
                  : agrees === false
                  ? "var(--amber-d, #92400e)"
                  : "rgb(126, 34, 206)",
                color:        "#fff",
                fontWeight:   800,
                fontSize:     14,
              }}
            >
              {suggestion.suggestedLetra}
            </span>

            <span style={{ fontSize: 11.5, color: "var(--slate-500)" }}>
              confianza:{" "}
              <b style={{ color: confidenceColor(suggestion.confidence) }}>
                {Math.round(suggestion.confidence * 100)}%
              </b>
            </span>

            {agrees === true && currentCorrectLetra && (
              <span
                style={{
                  marginLeft:   "auto",
                  display:      "inline-flex",
                  alignItems:   "center",
                  gap:          5,
                  padding:      "3px 9px",
                  borderRadius: 999,
                  background:   "rgba(34, 197, 94, 0.12)",
                  color:        "var(--green-d)",
                  fontSize:     11,
                  fontWeight:   800,
                }}
              >
                <CheckCircle2 className="h-3 w-3" />
                Coincide con la marcada
              </span>
            )}
            {agrees === false && currentCorrectLetra && (
              <span
                title={`Tú tienes marcada la ${currentCorrectLetra}, la IA sugiere ${suggestion.suggestedLetra}`}
                style={{
                  marginLeft:   "auto",
                  display:      "inline-flex",
                  alignItems:   "center",
                  gap:          5,
                  padding:      "3px 9px",
                  borderRadius: 999,
                  background:   "rgba(245, 158, 11, 0.15)",
                  color:        "var(--amber-d, #92400e)",
                  fontSize:     11,
                  fontWeight:   800,
                  cursor:       "help",
                }}
              >
                <AlertCircle className="h-3 w-3" />
                Diferente a la marcada ({currentCorrectLetra})
              </span>
            )}
          </div>

          {suggestion.reasoning && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--slate-500)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                Razonamiento
              </div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--slate-700)" }}>
                {suggestion.reasoning}
              </p>
            </div>
          )}

          {suggestion.dgtBasis && (
            <div
              style={{
                padding:      "8px 10px",
                borderRadius: 8,
                background:   "rgba(245, 158, 11, 0.08)",
                border:       "1px solid rgba(245, 158, 11, 0.25)",
                display:      "flex",
                gap:          8,
                alignItems:   "flex-start",
              }}
            >
              <BookOpen className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--amber-d, #92400e)", marginTop: 2 }} />
              <div style={{ fontSize: 12.5, color: "var(--slate-700)", lineHeight: 1.5 }}>
                <b>Base normativa:</b> {suggestion.dgtBasis}
              </div>
            </div>
          )}

          <div style={{ fontSize: 10.5, color: "var(--slate-400)", textAlign: "right" }}>
            modelo: {suggestion.model}
          </div>
        </div>
      )}
    </div>
  )
}

function confidenceColor(c: number): string {
  if (c >= 0.8) return "var(--green-d)"
  if (c >= 0.5) return "var(--amber-d, #92400e)"
  return "var(--red-600)"
}
