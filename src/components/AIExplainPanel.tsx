"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Sparkles,
  Loader2,
  ImageIcon,
  XCircle,
  Lightbulb,
  CheckCircle2,
} from "lucide-react"
import { ExplanationWithHighlights } from "@/components/ExplanationWithHighlights"

export interface AIResult {
  mainExplanation: string
  whyCorrect:      string
  whyOthersWrong:  Record<string, string>
  keyPhrases:      string[]
}

interface Props {
  questionId:   number
  /** Explicación oficial — sobre la que se aplica el subrayado. */
  explicacion:  string
  /** Si la pregunta tiene imagen, se habilita el switch para enviarla. */
  hasImage:     boolean
  /** Cuántas preguntas a la IA le quedan al usuario. */
  remaining:    number
  /** Total de preguntas permitidas (para mostrar X/5). */
  maxAllowed:   number
  /** Se llama si la IA devolvió respuesta (cached o no). Sirve para descontar quota. */
  onConsume:    (cached: boolean) => void
  /** Pasar las key phrases al panel padre para sincronizar el subrayado del enunciado. */
  onResult?:    (result: AIResult) => void
}

const PRESET_QUESTIONS = [
  { id: "why-correct", label: "¿Por qué es esta la respuesta correcta?" },
  { id: "why-others",  label: "¿Por qué las otras opciones no son correctas?" },
  { id: "key",         label: "Subraya las partes clave de la explicación" },
] as const

export function AIExplainPanel({
  questionId,
  explicacion,
  hasImage,
  remaining,
  maxAllowed,
  onConsume,
  onResult,
}: Props) {
  const [open, setOpen] = useState(false)
  const [withImage, setWithImage] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AIResult | null>(null)
  const [cached, setCached] = useState(false)

  const noQuota = remaining <= 0

  async function askAI() {
    if (noQuota || loading) return
    setError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/ai/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, withImage: hasImage && withImage }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? "Error al consultar la IA")
      }
      const data = (await res.json()) as { cached: boolean; result: AIResult }
      setResult(data.result)
      setCached(data.cached)
      onResult?.(data.result)
      onConsume(data.cached)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setResult(null); setError(null) } }}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2"
          style={{
            padding: "8px 14px",
            borderRadius: 10,
            border: "1.5px solid rgba(168, 85, 247, 0.45)",
            background: "linear-gradient(120deg, rgba(168, 85, 247, 0.10) 0%, rgba(236, 72, 153, 0.10) 100%)",
            color: "rgb(126, 34, 206)",
            fontWeight: 700,
            fontSize: 13,
            cursor: noQuota ? "not-allowed" : "pointer",
            opacity: noQuota ? 0.5 : 1,
          }}
          disabled={noQuota}
          title={noQuota ? "Sin preguntas disponibles para este examen" : "Pregúntale a la IA"}
        >
          <Sparkles className="h-4 w-4" />
          Pregunta a la IA
          <span
            className="font-mono-tabular"
            style={{
              marginLeft: 4,
              padding: "1px 6px",
              borderRadius: 6,
              background: "rgba(168, 85, 247, 0.18)",
              fontSize: 11,
            }}
          >
            {remaining}/{maxAllowed}
          </span>
        </button>
      </DialogTrigger>

      <DialogContent className="!max-w-[min(94vw,640px)] !w-[min(94vw,640px)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" style={{ color: "rgb(168, 85, 247)" }} />
            Asistente IA
            <span
              className="font-mono-tabular"
              style={{
                marginLeft: "auto",
                padding: "2px 8px",
                borderRadius: 8,
                background: "rgba(168, 85, 247, 0.12)",
                color: "rgb(126, 34, 206)",
                fontSize: 12,
              }}
            >
              {remaining}/{maxAllowed}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Switch enviar imagen */}
        {hasImage && (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--slate-200)",
              background: "rgba(148, 163, 184, 0.06)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            <ImageIcon className="h-4 w-4" style={{ color: "var(--slate-500)" }} />
            <span style={{ flex: 1 }}>Enviar la imagen de la pregunta a la IA</span>
            <input
              type="checkbox"
              checked={withImage}
              onChange={(e) => setWithImage(e.target.checked)}
              style={{ accentColor: "rgb(168, 85, 247)", width: 18, height: 18 }}
            />
          </label>
        )}

        {/* Si todavía no hay resultado, mostrar las opciones de pregunta */}
        {!result && (
          <div className="space-y-2">
            {PRESET_QUESTIONS.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={askAI}
                disabled={loading || noQuota}
                className="w-full text-left transition flex items-center gap-3"
                style={{
                  padding: 12,
                  borderRadius: 10,
                  border: "1.5px solid var(--slate-200)",
                  background: "#fff",
                  fontSize: 13.5,
                  cursor: loading || noQuota ? "wait" : "pointer",
                }}
              >
                <Lightbulb className="h-4 w-4 flex-shrink-0" style={{ color: "rgb(168, 85, 247)" }} />
                <span style={{ flex: 1 }}>{q.label}</span>
              </button>
            ))}
            <p
              style={{
                margin: "6px 4px 0",
                fontSize: 11.5,
                color: "var(--slate-500)",
                lineHeight: 1.4,
              }}
            >
              Las preguntas preset son siempre las mismas. La IA analizará la pregunta, las opciones
              y la explicación oficial. La respuesta se cachea, así que si vuelves a esta pregunta
              en el futuro no consumirá quota.
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div
            style={{
              padding: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              color: "var(--slate-600)",
              fontSize: 13.5,
            }}
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Consultando a la IA...
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              background: "rgba(239, 68, 68, 0.08)",
              border: "1px solid rgba(239, 68, 68, 0.35)",
              color: "var(--red-600)",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <XCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {/* Resultado */}
        {result && (
          <div className="space-y-4" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
            {cached && (
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--slate-500)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Respuesta cacheada · sin gasto de IA
              </div>
            )}

            {result.mainExplanation && (
              <section>
                <h4 style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 800, color: "var(--slate-500)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Idea clave
                </h4>
                <p style={{ margin: 0 }}>{result.mainExplanation}</p>
              </section>
            )}

            {result.whyCorrect && (
              <section
                style={{
                  borderRadius: 10,
                  padding: "10px 12px",
                  background: "rgba(34, 197, 94, 0.08)",
                  border: "1px solid rgba(34, 197, 94, 0.25)",
                }}
              >
                <h4 style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 800, color: "var(--green-d)", textTransform: "uppercase", letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: 6 }}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Por qué la correcta es la correcta
                </h4>
                <p style={{ margin: 0 }}>{result.whyCorrect}</p>
              </section>
            )}

            {Object.keys(result.whyOthersWrong).length > 0 && (
              <section>
                <h4 style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 800, color: "var(--slate-500)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Por qué las otras no
                </h4>
                <div className="space-y-2">
                  {Object.entries(result.whyOthersWrong).map(([letra, txt]) => (
                    <div
                      key={letra}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        padding: "8px 10px",
                        borderRadius: 8,
                        background: "rgba(239, 68, 68, 0.06)",
                        border: "1px solid rgba(239, 68, 68, 0.18)",
                      }}
                    >
                      <span
                        className="font-mono-tabular"
                        style={{
                          flexShrink: 0,
                          padding: "1px 7px",
                          borderRadius: 6,
                          background: "var(--red-500)",
                          color: "#fff",
                          fontSize: 11,
                          fontWeight: 800,
                        }}
                      >
                        {letra.toUpperCase()}
                      </span>
                      <span>{txt}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Explicación oficial con subrayado animado */}
            <section
              style={{
                marginTop: 4,
                padding: "12px 14px",
                background: "rgba(245, 158, 11, 0.08)",
                borderRadius: 10,
                border: "1px solid rgba(245, 158, 11, 0.25)",
              }}
            >
              <h4 style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 800, color: "var(--amber-d)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Explicación oficial
              </h4>
              <ExplanationWithHighlights
                text={explicacion}
                highlights={result.keyPhrases}
              />
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
