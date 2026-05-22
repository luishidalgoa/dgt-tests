"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Sparkles,
  Loader2,
  ImageIcon,
  XCircle,
  CheckCircle2,
  Wand2,
} from "lucide-react"
import { ExplanationWithHighlights } from "@/components/ExplanationWithHighlights"

export interface AIResult {
  mainExplanation: string
  whyCorrect:      string
  whyOthersWrong:  Record<string, string>
  keyPhrases:      string[]
}

export interface MonthlyQuota {
  used:      number
  max:       number
  remaining: number
  month:     string
  resetsAt:  string
}

/** Evento usado para que el chip de tokens en el navbar se actualice
 *  en vivo cuando la IA consume quota (sin esperar a router.refresh). */
export const AI_QUOTA_CHANGED_EVENT = "dgt:ai-quota-changed"

/**
 * Mapeo de códigos de error del endpoint a textos del toast. Si el
 * backend devuelve un code conocido, usamos este texto traducido (más
 * útil para el usuario que un "503 Service Unavailable" genérico). Si
 * llega un code "ai_*" desconocido, hacemos fallback al body.error
 * que ya viene amigable del backend.
 */
const AI_ERROR_TOASTS: Record<string, { title: string; description: string }> = {
  ai_unavailable: {
    title:       "Análisis IA no disponible ahora mismo",
    description: "Estamos saturados temporalmente. Inténtalo en unos minutos.",
  },
  ai_misconfigured: {
    title:       "Servicio de IA no disponible",
    description: "Hay un problema de configuración en el servidor. Avisa al administrador.",
  },
  ai_bad_request: {
    title:       "La IA no pudo procesar esta pregunta",
    description: "Prueba con otra pregunta, esta no se ha podido analizar.",
  },
  ai_server_error: {
    title:       "Error temporal del modelo de IA",
    description: "Inténtalo en unos minutos, el proveedor está fallando.",
  },
  ai_error: {
    title:       "No se pudo generar el análisis",
    description: "Algo ha fallado. Inténtalo más tarde.",
  },
}

function emitQuotaChange(quota: MonthlyQuota) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(AI_QUOTA_CHANGED_EVENT, { detail: quota }))
}

interface Props {
  questionId:   number
  /** Explicación oficial — sobre la que se aplica el subrayado. */
  explicacion:  string
  /** Si la pregunta tiene imagen, se envía siempre automáticamente. */
  hasImage:     boolean
  /** Cuántas preguntas a la IA le quedan al usuario. */
  remaining:    number
  /** Total de preguntas permitidas (para mostrar X/5). */
  maxAllowed:   number
  /** Letra de la opción correcta (para mostrar su texto en "por qué es la correcta"). */
  correctLetra?: string
  /** Opciones de la pregunta (para mostrar texto + letra en el panel). */
  options?:     { letra: string; texto: string }[]
  /**
   * ID del ExamAttempt al que se asocia el pago. Si va, el pago es
   * "per-attempt": re-ver el mismo attempt es gratis pero un attempt
   * nuevo del mismo test cobra otra vez. Si NO va (undefined), el pago
   * es global por (user, question) — útil en modo práctica.
   */
  attemptId?:   number
  /**
   * Pre-cargado server-side: la combinación (questionId, withImage) en este
   * scope (attempt o global) ya ha sido pagada por el usuario. Si va a true,
   * el botón muestra el badge "✓ Gratis" en verde en lugar del contador X/5
   * y deja entrar aunque la quota esté agotada.
   */
  initiallyPaid?: boolean
  /** Se llama si la IA devolvió respuesta (cached o no). Sirve para descontar quota. */
  onConsume:    (cached: boolean) => void
  /** Pasar las key phrases al panel padre para sincronizar el subrayado. */
  onResult?:    (result: AIResult) => void
}

export function AIExplainPanel({
  questionId,
  explicacion,
  hasImage,
  remaining,
  maxAllowed,
  correctLetra,
  options = [],
  attemptId,
  initiallyPaid = false,
  onConsume,
  onResult,
}: Props) {
  // Mapa letra → texto, en mayúsculas para el lookup
  const textByLetra: Record<string, string> = {}
  for (const o of options) textByLetra[o.letra.toUpperCase()] = o.texto
  const correctText = correctLetra ? textByLetra[correctLetra.toUpperCase()] : undefined
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [result, setResult]   = useState<AIResult | null>(null)
  const [cached, setCached]   = useState(false)
  const [quota, setQuota]     = useState<MonthlyQuota | null>(null)

  // alreadyPaid=true cuando el user ya gastó token por esta pregunta
  // previamente. Se inicializa con initiallyPaid (resuelto server-side por
  // el padre) para poder marcar el botón como "gratis" desde el primer
  // render, sin esperar a que abra el modal y dispare el GET.
  const [alreadyPaid, setAlreadyPaid] = useState(initiallyPaid)
  // Mientras hacemos el GET para comprobar si ya pagó, mostramos un loader
  // suave en vez del CTA, para no parpadear el "1 token" antes de saberlo.
  const [checkingPaid, setCheckingPaid] = useState(false)

  // Recordamos qué questionId ya hemos chequeado para no re-disparar el
  // GET en cada re-render. Sin esto el effect entraba en un bucle:
  // setCheckingPaid(true) → re-render → cleanup invalida cancelled del
  // promise original → finally no resetea checkingPaid → "Comprobando..."
  // se quedaba pegado.
  const checkedForRef = useRef<string | null>(null)

  // Callback estable: si el padre re-renderiza y pasa una nueva referencia
  // de onResult, no queremos que dispare otro GET. Guardamos en ref.
  const onResultRef = useRef(onResult)
  useEffect(() => { onResultRef.current = onResult }, [onResult])

  const noQuota = remaining <= 0

  // Al abrir el modal POR PRIMERA VEZ con esta questionId, comprobamos
  // si el user ya había pagado por esta explicación. Si sí, la cargamos
  // automáticamente sin cobrar. Si no, dejamos el CTA "Generar · 1 token".
  useEffect(() => {
    if (!open) return
    if (result) return
    const key = `${questionId}:${hasImage}`
    if (checkedForRef.current === key) return  // ya chequeado esta combinación

    checkedForRef.current = key
    setCheckingPaid(true)
    let cancelled = false

    const qs = new URLSearchParams({
      questionId: String(questionId),
      withImage:  hasImage ? "true" : "false",
    })
    if (attemptId) qs.set("attemptId", String(attemptId))
    fetch(`/api/ai/explain?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { alreadyPaid?: boolean; result?: AIResult } | null) => {
        if (cancelled || !data) return
        if (data.alreadyPaid && data.result) {
          setResult(data.result)
          setCached(true)
          setAlreadyPaid(true)
          onResultRef.current?.(data.result)
        }
      })
      .catch(() => { /* silencio: el usuario podrá usar el CTA igualmente */ })
      .finally(() => { if (!cancelled) setCheckingPaid(false) })

    return () => { cancelled = true }
  }, [open, questionId, hasImage, attemptId, result])

  async function askAI() {
    if (noQuota || loading) return
    setError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/ai/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId,
          withImage: hasImage,
          ...(attemptId ? { attemptId } : {}),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        if (body.quota) {
          setQuota(body.quota)
          emitQuotaChange(body.quota)
        }
        // Todos los errores del provider de IA (rate limit, key inválida,
        // bad request, server error...) se muestran como toast amigable
        // y cerramos el modal. NUNCA pintamos el mensaje crudo del
        // backend en el panel — el backend ya manda un texto traducido.
        const code: string | undefined = body.code
        if (typeof code === "string" && code.startsWith("ai_")) {
          const meta = AI_ERROR_TOASTS[code] ?? {
            title:       "Análisis IA no disponible",
            description: typeof body.error === "string"
              ? body.error
              : "Inténtalo en unos minutos.",
          }
          toast.error(meta.title, {
            description: meta.description,
            duration:    7000,
          })
          setOpen(false)
          return
        }
        // Caso raro (4xx no-IA, 401 de auth, etc.): error inline genérico
        // sin filtrar mensaje crudo.
        throw new Error(typeof body.error === "string" ? body.error : "Error al consultar la IA")
      }
      const data = (await res.json()) as {
        cached:   boolean
        result:   AIResult
        quota?:   MonthlyQuota
        charged?: boolean      // true si esta llamada cobró 1 token
      }
      setResult(data.result)
      setCached(data.cached)
      setAlreadyPaid(data.charged === false)
      if (data.quota) {
        setQuota(data.quota)
        emitQuotaChange(data.quota)
      }
      onResult?.(data.result)
      // Solo descontamos quota en el padre si realmente cobramos
      if (data.charged !== false) {
        onConsume(data.cached)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }

  function handleOpenChange(v: boolean) {
    setOpen(v)
    if (!v) {
      // Mantenemos el resultado en memoria para evitar refetch si vuelve a abrir;
      // pero limpiamos errores transitorios
      setError(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
            // Si ya está pagado, el botón nunca se deshabilita por quota:
            // ver una respuesta ya pagada no consume nada.
            cursor: noQuota && !alreadyPaid ? "not-allowed" : "pointer",
            opacity: noQuota && !alreadyPaid ? 0.5 : 1,
          }}
          disabled={noQuota && !alreadyPaid}
          title={
            alreadyPaid
              ? "Ya pagaste esta explicación · verla es gratis"
              : noQuota
              ? "Sin preguntas disponibles para este examen"
              : "Pregúntale a la IA"
          }
        >
          <Sparkles className="h-4 w-4" />
          Analizar con IA
          {alreadyPaid ? (
            <span
              className="font-mono-tabular"
              style={{
                marginLeft:    4,
                padding:       "1px 7px",
                borderRadius:  6,
                background:    "#e7f2df",
                color:         "#3d7a1a",
                border:        "1px solid #c5dcb0",
                fontSize:      11,
                fontWeight:    800,
                lineHeight:    1.4,
              }}
              aria-label="Gratis · ya pagado"
            >
              ✓<span className="hidden sm:inline" style={{ marginLeft: 3 }}>Gratis</span>
            </span>
          ) : (
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
          )}
        </button>
      </DialogTrigger>

      <DialogContent
        className="!max-w-[min(94vw,640px)] !w-[min(94vw,640px)] !max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" style={{ color: "rgb(168, 85, 247)" }} />
            Análisis IA
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
          <DialogDescription className="sr-only">
            Análisis con IA de la pregunta actual: idea clave, justificación de la respuesta correcta,
            explicación de las otras opciones y subrayado de las frases clave.
          </DialogDescription>
        </DialogHeader>

        {/* Quota mensual */}
        {quota && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "8px 12px",
              borderRadius: 10,
              background: "rgba(168, 85, 247, 0.06)",
              border: "1px solid rgba(168, 85, 247, 0.20)",
              fontSize: 12,
              color: "var(--slate-600)",
            }}
          >
            <span>
              Te quedan{" "}
              <b style={{ color: quota.remaining <= 5 ? "var(--red-600)" : "rgb(126, 34, 206)" }}>
                {quota.remaining}/{quota.max}
              </b>{" "}
              tokens <span style={{ color: "var(--slate-500)" }}>· reset el 1 del próximo mes</span>
            </span>
          </div>
        )}

        {/* Comprobando si ya pagaste (GET inicial) */}
        {!result && checkingPaid && !error && (
          <div
            style={{
              padding: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              color: "var(--slate-500)",
              fontSize: 13,
            }}
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Comprobando...
          </div>
        )}

        {/* Estado inicial: CTA para generar */}
        {!result && !loading && !checkingPaid && !error && (
          <div className="space-y-3">
            <div
              style={{
                padding: "14px 16px",
                borderRadius: 12,
                background: "rgba(168, 85, 247, 0.06)",
                border: "1px solid rgba(168, 85, 247, 0.25)",
                fontSize: 13.5,
                lineHeight: 1.55,
                color: "var(--slate-700)",
              }}
            >
              La IA te dará en una sola respuesta:
              <ul style={{ margin: "8px 0 0 18px", padding: 0, fontSize: 13 }}>
                <li>La idea clave del concepto</li>
                <li>Por qué la opción correcta es la correcta</li>
                <li>Por qué las otras opciones no son válidas</li>
                <li>Las frases más importantes subrayadas en amarillo</li>
              </ul>
              {hasImage && (
                <p
                  style={{
                    margin: "10px 0 0",
                    fontSize: 12,
                    color: "var(--slate-500)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  La imagen de la pregunta se envía automáticamente.
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={askAI}
              disabled={noQuota}
              className="w-full inline-flex items-center justify-center gap-2"
              style={{
                padding: "12px 16px",
                borderRadius: 12,
                border: 0,
                background:
                  "linear-gradient(135deg, rgb(168, 85, 247), rgb(236, 72, 153))",
                color: "#fff",
                fontWeight: 800,
                fontSize: 14,
                cursor: noQuota ? "not-allowed" : "pointer",
                opacity: noQuota ? 0.5 : 1,
                boxShadow: "0 10px 22px -10px rgba(168, 85, 247, 0.55)",
              }}
            >
              <Wand2 className="h-4 w-4" />
              {noQuota ? "Sin quota disponible" : "Generar análisis · 1 token"}
            </button>
            <p
              style={{
                margin: "0 4px",
                fontSize: 11.5,
                color: "var(--slate-500)",
                lineHeight: 1.4,
              }}
            >
              Cada análisis cuesta 1 token de tu quota mensual.
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
            {alreadyPaid ? (
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: "var(--green-d)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "rgba(34, 197, 94, 0.10)",
                  border: "1px solid rgba(34, 197, 94, 0.30)",
                }}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Sin coste — ya pagaste por esta explicación
              </div>
            ) : cached && (
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--slate-500)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Respuesta reutilizada del cache
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
                {correctText && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      marginTop: 6,
                      marginBottom: 8,
                      padding: "6px 8px",
                      borderRadius: 8,
                      background: "rgba(34, 197, 94, 0.10)",
                      border: "1px dashed rgba(34, 197, 94, 0.35)",
                    }}
                  >
                    {correctLetra && (
                      <span
                        className="font-mono-tabular"
                        style={{
                          flexShrink: 0,
                          padding: "1px 7px",
                          borderRadius: 6,
                          background: "var(--green)",
                          color: "#fff",
                          fontSize: 11,
                          fontWeight: 800,
                        }}
                      >
                        {correctLetra.toUpperCase()}
                      </span>
                    )}
                    <span style={{ fontSize: 13, fontStyle: "italic", color: "var(--green-d)" }}>
                      {correctText}
                    </span>
                  </div>
                )}
                <p style={{ margin: 0 }}>{result.whyCorrect}</p>
              </section>
            )}

            {Object.keys(result.whyOthersWrong).length > 0 && (
              <section>
                <h4 style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 800, color: "var(--slate-500)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Por qué las otras no
                </h4>
                <div className="space-y-2">
                  {Object.entries(result.whyOthersWrong).map(([letra, txt]) => {
                    const optText = textByLetra[letra.toUpperCase()]
                    return (
                      <div
                        key={letra}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 8,
                          background: "rgba(239, 68, 68, 0.06)",
                          border: "1px solid rgba(239, 68, 68, 0.18)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
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
                          {optText && (
                            <span
                              style={{
                                fontSize: 13,
                                fontStyle: "italic",
                                color: "var(--slate-600)",
                                lineHeight: 1.45,
                              }}
                            >
                              {optText}
                            </span>
                          )}
                        </div>
                        <p style={{ margin: "6px 0 0", paddingLeft: 30 }}>{txt}</p>
                      </div>
                    )
                  })}
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
