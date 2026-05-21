"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Loader2, Trophy, Zap } from "lucide-react"
import type { PartyState } from "@/lib/party"

interface QuestionDTO {
  id:         number
  externalId: string
  enunciado:  string
  imagen:     string | null
  codigoTema: string | null
  tier?:      "FREE" | "PRO"
  options:    { id: number; letra: string; texto: string }[]
}

export function PartyRunner({ code }: { code: string }) {
  const router = useRouter()
  const [questions, setQuestions] = useState<QuestionDTO[] | null>(null)
  const [hostIsFree, setHostIsFree] = useState(false)
  const [current, setCurrent]     = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [finished, setFinished]   = useState(false)
  const [state, setState]         = useState<PartyState | null>(null)
  const [feedback, setFeedback]   = useState<"correct" | "wrong" | null>(null)
  const questionStartRef = useRef<number>(Date.now())

  // Cargar preguntas
  useEffect(() => {
    let alive = true
    fetch(`/api/parties/${code}/questions`)
      .then((r) => r.json())
      .then((data) => {
        if (alive) {
          setQuestions(data.questions)
          setHostIsFree(Boolean(data.hostIsFree))
          questionStartRef.current = Date.now()
        }
      })
    return () => { alive = false }
  }, [code])

  // Polling del estado para mostrar leaderboard live
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    async function tick() {
      try {
        const r = await fetch(`/api/parties/${code}`, { cache: "no-store" })
        if (r.ok && alive) {
          const data = await r.json() as PartyState
          setState(data)
          if (data.status === "finished") {
            router.push(`/party/${code}/results`)
            return
          }
        }
      } catch {}
      if (alive) timer = setTimeout(tick, 2500)
    }
    tick()
    return () => { alive = false; clearTimeout(timer) }
  }, [code, router])

  const submitAnswer = useCallback(async (optionId: number | null) => {
    if (!questions || submitting) return
    setSubmitting(true)
    const q = questions[current]
    const elapsed = Date.now() - questionStartRef.current

    try {
      const r = await fetch(`/api/parties/${code}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          questionId:       q.id,
          selectedOptionId: optionId,
          timeMs:           elapsed,
        }),
      })
      const data = await r.json()
      setFeedback(data.isCorrect ? "correct" : "wrong")

      // Avanzar a la siguiente pregunta tras 800ms
      setTimeout(() => {
        setFeedback(null)
        const next = current + 1
        if (next >= questions.length) {
          // Finalizar
          fetch(`/api/parties/${code}/finish`, { method: "POST" }).then(() => {
            setFinished(true)
          })
        } else {
          setCurrent(next)
          questionStartRef.current = Date.now()
        }
        setSubmitting(false)
      }, 800)
    } catch {
      setSubmitting(false)
    }
  }, [code, current, questions, submitting])

  // Loading
  if (!questions) {
    return (
      <div className="empty-state">
        <Loader2 className="h-6 w-6 animate-spin mx-auto" style={{ color: "var(--orange-600)" }} />
        <div style={{ marginTop: 12 }}>Cargando preguntas...</div>
      </div>
    )
  }

  // Esperando a los demás
  if (finished) {
    return (
      <div>
        <div className="card-soft warm" style={{ padding: 32, textAlign: "center", marginBottom: 16 }}>
          <Trophy className="h-12 w-12 mx-auto" style={{ color: "var(--green)" }} />
          <h2 style={{ fontSize: 24, fontWeight: 800, margin: "12px 0 6px" }}>¡Has terminado!</h2>
          <p style={{ color: "var(--slate-500)", margin: 0 }}>
            Esperando a que los demás terminen...
          </p>
        </div>
        {state && <LiveLeaderboard state={state} />}
      </div>
    )
  }

  const q = questions[current]
  const progress = ((current + 1) / questions.length) * 100

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 280px" }}>
      <div>
        {/* Progreso */}
        <div className="card-soft" style={{ padding: 14, marginBottom: 14 }}>
          <div className="flex items-center justify-between mb-2" style={{ fontSize: 13, color: "var(--slate-500)", fontWeight: 600 }}>
            <span>Pregunta {current + 1} / {questions.length}</span>
            <span className="font-mono-tabular flex items-center gap-1" style={{ color: "var(--orange-600)" }}>
              <Zap className="h-3.5 w-3.5" />
              {state?.players.find((p) => p.isYou)?.score ?? 0} pts
            </span>
          </div>
          <div style={{ height: 6, background: "var(--slate-100)", borderRadius: 999, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${progress}%`,
                background: "linear-gradient(90deg, var(--orange-500), var(--red-600))",
                transition: "width 0.3s",
              }}
            />
          </div>
        </div>

        {/* Pregunta */}
        <div className="card-soft" style={{ padding: 24 }}>
          <div className="grid gap-6 md:grid-cols-[260px_1fr]">
            <div>
              {q.imagen ? (
                <div className="relative aspect-square rounded-xl overflow-hidden" style={{ background: "var(--slate-100)" }}>
                  <Image src={`/images/${q.imagen}`} alt={`Pregunta ${current + 1}`} fill className="object-contain" sizes="260px" priority />
                </div>
              ) : (
                <div className="aspect-square rounded-xl flex items-center justify-center" style={{ background: "var(--slate-100)", color: "var(--slate-300)" }}>
                  sin imagen
                </div>
              )}
              {q.codigoTema && (
                <div className="font-mono-tabular text-center mt-2" style={{ fontSize: 11, color: "var(--slate-500)" }}>
                  {q.codigoTema}
                </div>
              )}
            </div>

            <div>
              {hostIsFree && (
                <div style={{ marginBottom: 10 }}>
                  <span
                    title="Esta party la creó un usuario del plan gratuito, por eso solo contiene preguntas del plan free."
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "3px 9px",
                      borderRadius: 999,
                      fontSize: 10.5,
                      fontWeight: 800,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      background: "rgba(34, 197, 94, 0.12)",
                      color: "var(--green-d)",
                      border: "1px solid rgba(34, 197, 94, 0.30)",
                    }}
                  >
                    Plan gratuito
                  </span>
                </div>
              )}
              <h2 className="text-lg font-semibold leading-snug m-0 mb-4">{q.enunciado}</h2>
              <div className="space-y-2">
                {q.options.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={submitting}
                    onClick={() => submitAnswer(opt.id)}
                    className="w-full text-left flex items-start gap-3 transition"
                    style={{
                      padding: 14,
                      borderRadius: 14,
                      border: "2px solid var(--slate-200)",
                      background: "#fff",
                      cursor: submitting ? "not-allowed" : "pointer",
                      opacity: submitting ? 0.5 : 1,
                    }}
                  >
                    <span
                      className="flex-shrink-0 flex items-center justify-center font-bold"
                      style={{
                        width: 32, height: 32, borderRadius: "50%", fontSize: 13,
                        border: "2px solid var(--slate-300)",
                        color: "var(--slate-600)",
                      }}
                    >
                      {opt.letra}
                    </span>
                    <span className="leading-snug pt-1" style={{ fontSize: 15 }}>{opt.texto}</span>
                  </button>
                ))}
              </div>

              {feedback === "correct" && (
                <div className="mt-3" style={{ color: "var(--green)", fontWeight: 700 }}>
                  ✓ ¡Correcto!
                </div>
              )}
              {feedback === "wrong" && (
                <div className="mt-3" style={{ color: "var(--red-500)", fontWeight: 700 }}>
                  ✗ Incorrecto
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Leaderboard live */}
      {state && <LiveLeaderboard state={state} />}
    </div>
  )
}


function LiveLeaderboard({ state }: { state: PartyState }) {
  const sorted = [...state.players].sort((a, b) => b.score - a.score)
  return (
    <aside className="card-soft" style={{ padding: 16, height: "fit-content", position: "sticky", top: 80 }}>
      <h3 style={{ fontSize: 13, fontWeight: 800, color: "var(--slate-500)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 0 }}>
        Marcador en vivo
      </h3>
      <div className="space-y-2 mt-3">
        {sorted.map((p, i) => (
          <div key={p.id} className="flex items-center gap-2" style={{
            padding: "8px 10px",
            borderRadius: 10,
            background: p.isYou ? "rgba(249, 115, 22, 0.08)" : "transparent",
            border: p.isYou ? "1px solid rgba(249, 115, 22, 0.35)" : "1px solid transparent",
          }}>
            <span style={{
              width: 20, height: 20, borderRadius: "50%",
              background: i === 0 ? "var(--amber)" : i === 1 ? "var(--slate-300)" : "var(--slate-200)",
              color: "#fff", fontSize: 11, fontWeight: 800,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>
                {p.name}{p.isYou && " (tú)"}
              </div>
              <div style={{ fontSize: 11, color: "var(--slate-500)" }}>
                {p.answeredCount}/{state.totalQuestions} {p.isFinished && "✓"}
              </div>
            </div>
            <div className="font-mono-tabular" style={{ fontSize: 14, fontWeight: 800, color: "var(--orange-600)" }}>
              {p.score}
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
