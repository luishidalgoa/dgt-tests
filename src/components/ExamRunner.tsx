"use client"

import { useState, useTransition, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { QuestionImage } from "@/components/QuestionImage"
import { AIExplainPanel, type AIResult } from "@/components/AIExplainPanel"
import { ExplanationWithHighlights } from "@/components/ExplanationWithHighlights"
import {
  loadExamState,
  saveExamState,
  clearExamState,
  type SavedExamState,
} from "@/lib/examState"
import {
  ArrowLeft,
  ArrowRight,
  LayoutGrid,
  CheckCircle2,
  XCircle,
  Loader2,
  Timer,
  AlertTriangle,
  Sparkles,
} from "lucide-react"
import type {
  TestRunnerData,
  SubmitAttemptPayload,
  SubmitAttemptResponse,
} from "@/types/exam"

interface ExamRunnerProps {
  data: TestRunnerData
  mode?: "normal" | "errores"
  /** Duración en segundos del temporizador. null = sin tiempo. */
  timeLimit?: number | null
  /** Si true, corregir en cliente y enviar a /preview-results en vez de POST /api/attempts. */
  isGuest?: boolean
  /** Máximo de preguntas a la IA por examen. 0 = sin acceso (guests). */
  aiQuota?: number
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0")
  const s = (seconds % 60).toString().padStart(2, "0")
  return `${m}:${s}`
}

export function ExamRunner({ data, mode = "normal", timeLimit = null, isGuest = false, aiQuota = 0 }: ExamRunnerProps) {
  const router = useRouter()
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<Record<number, number | null>>({})
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(timeLimit)
  const [mapOpen, setMapOpen] = useState(false)
  const [aiRemaining, setAiRemaining] = useState(aiQuota)
  // Resultados de la IA cacheados por questionId (para no perderlos al navegar)
  const [aiResults, setAiResults] = useState<Record<number, AIResult>>({})
  const submittedRef = useRef(false)
  // Refs para la persistencia
  const startedAtRef = useRef<string>(new Date().toISOString())
  const hydratedRef  = useRef(false)
  const [hydrated, setHydrated] = useState(false)

  const { questions, test } = data
  const total = questions.length
  const q = questions[current]
  const selected = answers[q.id] ?? null
  const answered = Object.values(answers).filter((v) => v !== null).length

  // Un examen es "reanudable" cuando viene de un test concreto (no /temas ni
  // /test-errores, que reparten preguntas aleatorias en cada visita).
  const isResumable = !isGuest && test.id > 0 && test.testNumber > 0
  const persistMode: "practica" | "examen" = timeLimit !== null ? "examen" : "practica"

  // Feedback en modo práctica: cuando llega correctOptionId del server y NO hay temporizador
  const showFeedback =
    timeLimit === null &&
    q.correctOptionId !== undefined &&
    selected !== null

  const selectedIsCorrect =
    showFeedback && selected !== null && selected === q.correctOptionId

  // ── Hidratación desde localStorage (solo 1 vez) ─────────────────────────
  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    if (!isResumable) {
      setHydrated(true)
      return
    }
    const saved = loadExamState()
    if (saved && saved.testId === test.id && saved.mode === persistMode) {
      // Restaurar respuestas válidas (solo las preguntas que existan)
      const validQuestionIds = new Set(questions.map((qu) => qu.id))
      const restoredAnswers: Record<number, number | null> = {}
      for (const [qid, oid] of Object.entries(saved.answers)) {
        const n = Number(qid)
        if (validQuestionIds.has(n)) restoredAnswers[n] = oid
      }
      setAnswers(restoredAnswers)
      // Pregunta actual (clavada al rango válido)
      const safeCurrent = Math.min(Math.max(0, saved.current), questions.length - 1)
      setCurrent(safeCurrent)
      startedAtRef.current = saved.startedAt
      // Recalcular el tiempo restante si es examen cronometrado
      if (timeLimit !== null) {
        const elapsed = (Date.now() - new Date(saved.startedAt).getTime()) / 1000
        const remaining = Math.max(0, timeLimit - Math.floor(elapsed))
        setSecondsLeft(remaining)
      }
    }
    setHydrated(true)
  }, [isResumable, test.id, persistMode, questions, timeLimit])

  // ── Guardado automático en cada cambio ──────────────────────────────────
  useEffect(() => {
    if (!hydrated || !isResumable) return
    // No sobrescribir el slot de "examen en curso" hasta que el usuario
    // haya hecho algo (al menos una respuesta o haya navegado).
    const hasActivity = answered > 0 || current > 0
    if (!hasActivity) return
    const state: SavedExamState = {
      categorySlug:   test.category.slug,
      categoryName:   test.category.name,
      categoryCode:   test.category.code,
      testId:         test.id,
      testNumber:     test.testNumber,
      mode:           persistMode,
      answers,
      current,
      startedAt:      startedAtRef.current,
      timeLimit,
      totalQuestions: questions.length,
    }
    saveExamState(state)
  }, [hydrated, isResumable, answered, answers, current, persistMode, questions.length, test.category.code, test.category.name, test.category.slug, test.id, test.testNumber, timeLimit])

  // ── Submit ──────────────────────────────────────────────────────────────
  const handleFinish = useCallback(() => {
    if (submittedRef.current) return
    submittedRef.current = true
    setError(null)

    // ── Modo invitado: corregir en cliente y guardar en sessionStorage ──
    if (isGuest) {
      try {
        let score = 0
        const answerDetails = questions.map((qu) => {
          const selectedOptionId = answers[qu.id] ?? null
          const isCorrect =
            selectedOptionId !== null && selectedOptionId === qu.correctOptionId
          if (isCorrect) score++
          return {
            questionId:       qu.id,
            enunciado:        qu.enunciado,
            imagen:           qu.imagen,
            codigoTema:       qu.codigoTema,
            options:          qu.options,
            correctOptionId:  qu.correctOptionId ?? null,
            selectedOptionId,
            isCorrect,
            explicacion:      qu.explicacion ?? null,
          }
        })

        const result = {
          test: {
            id:         test.id,
            testNumber: test.testNumber,
            category:   test.category,
          },
          score,
          total: questions.length,
          mode,
          finishedAt: new Date().toISOString(),
          answers: answerDetails,
        }

        sessionStorage.setItem("dgt:guest-result", JSON.stringify(result))
        clearExamState()
        router.push("/preview-results")
      } catch (err) {
        submittedRef.current = false
        setError(err instanceof Error ? err.message : "Error al corregir el test")
      }
      return
    }

    const payload: SubmitAttemptPayload = {
      testId: test.id,
      mode,
      answers: questions.map((qu) => ({
        questionId:       qu.id,
        selectedOptionId: answers[qu.id] ?? null,
      })),
    }

    startTransition(async () => {
      try {
        const res = await fetch("/api/attempts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? "Error al guardar el intento")
        }
        const data = (await res.json()) as SubmitAttemptResponse
        clearExamState()
        router.push(data.redirectUrl)
      } catch (err) {
        submittedRef.current = false
        setError(err instanceof Error ? err.message : "Error desconocido")
      }
    })
  }, [answers, isGuest, mode, questions, router, test.id, test.testNumber, test.category])

  // ── Temporizador ────────────────────────────────────────────────────────
  useEffect(() => {
    if (secondsLeft === null) return
    if (secondsLeft <= 0) {
      handleFinish()
      return
    }
    const id = setTimeout(() => setSecondsLeft((s) => (s === null ? null : s - 1)), 1000)
    return () => clearTimeout(id)
  }, [secondsLeft, handleFinish])

  // ── Selección y navegación ──────────────────────────────────────────────
  const selectOption = useCallback(
    (optId: number) => {
      setAnswers((prev) => ({ ...prev, [q.id]: optId }))
    },
    [q.id]
  )

  const goTo = useCallback(
    (i: number) => {
      if (i < 0 || i >= total) return
      setCurrent(i)
    },
    [total]
  )

  // ── Atajos de teclado ───────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignorar si el usuario está escribiendo en un input
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA") return
      // No interceptar si hay modificadores
      if (e.ctrlKey || e.metaKey || e.altKey) return

      // Letras A/B/C/D o números 1/2/3/4 → seleccionar opción
      const key = e.key.toUpperCase()
      const numberIdx = "1234".indexOf(key)
      const letterIdx = "ABCD".indexOf(key)
      const idx = numberIdx >= 0 ? numberIdx : letterIdx
      if (idx >= 0 && idx < q.options.length) {
        selectOption(q.options[idx].id)
        e.preventDefault()
        return
      }

      // Flechas para navegar
      if (e.key === "ArrowLeft") {
        goTo(current - 1)
        e.preventDefault()
        return
      }
      if (e.key === "ArrowRight") {
        goTo(current + 1)
        e.preventDefault()
        return
      }

      // M → abrir mapa
      if (e.key === "m" || e.key === "M") {
        setMapOpen((v) => !v)
        e.preventDefault()
        return
      }

      // ENTER → finalizar
      if (e.key === "Enter") {
        handleFinish()
        e.preventDefault()
      }
    }

    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [current, q.options, selectOption, goTo, handleFinish])

  const isExamMode = timeLimit !== null

  return (
    <div className="space-y-6">
      {/* Header con progreso y timer */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm text-slate-600 gap-4">
          <span className="truncate">
            {test.category.name}
            {test.testNumber > 0 && ` · Test ${test.testNumber}`}
          </span>

          <div className="flex items-center gap-4 flex-shrink-0">
            {isExamMode && secondsLeft !== null && (
              <span
                className={`flex items-center gap-1 font-mono font-semibold ${
                  secondsLeft < 60
                    ? "text-red-600"
                    : secondsLeft < 300
                    ? "text-amber-600"
                    : "text-slate-700"
                }`}
              >
                <Timer className="h-4 w-4" />
                {formatTime(secondsLeft)}
              </span>
            )}
            <span>
              Pregunta {current + 1} / {total}
              <span className="ml-3 text-slate-400">·</span>
              <span className="ml-3">Respondidas: {answered}</span>
            </span>
          </div>
        </div>
        <Progress value={((current + 1) / total) * 100} className="h-2" />
      </div>

      {/* Pregunta + opciones */}
      <div className="card-soft" style={{ padding: 24 }}>
        <div className="grid gap-6 md:grid-cols-[300px_1fr]">
            {/* Imagen */}
            <div className="space-y-3">
              <QuestionImage
                src={q.imagen}
                alt={`Pregunta ${current + 1}`}
                title={`Pregunta ${current + 1}${q.codigoTema ? ` · ${q.codigoTema}` : ""}`}
                size={300}
              />
              {q.codigoTema && (
                <div
                  className="text-xs text-center font-mono-tabular"
                  style={{ color: "var(--slate-500)" }}
                >
                  {q.codigoTema}
                </div>
              )}
            </div>

            {/* Enunciado + opciones */}
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <span
                  className="font-mono-tabular"
                  style={{
                    background: "linear-gradient(180deg, var(--orange-500), var(--red-600))",
                    color: "#fff",
                    fontWeight: 800,
                    fontSize: 14,
                    padding: "4px 10px",
                    borderRadius: 8,
                    marginTop: 2,
                  }}
                >
                  {current + 1}
                </span>
                <h2 className="text-lg font-semibold leading-snug m-0">{q.enunciado}</h2>
              </div>

              <div className="space-y-2 mt-4">
                {q.options.map((opt, i) => {
                  const isSelected = selected === opt.id
                  const hint = String.fromCharCode(65 + i) // A, B, C, D

                  // ── Estilos en función de si hay feedback de práctica ──
                  let borderColor: string = isSelected ? "var(--orange-500)" : "var(--slate-200)"
                  let background: string = isSelected ? "rgba(249, 115, 22, 0.08)" : "#fff"
                  let bubbleBg: string = isSelected
                    ? "linear-gradient(180deg, var(--orange-500), var(--red-600))"
                    : "transparent"
                  let bubbleColor: string = isSelected ? "#fff" : "var(--slate-600)"
                  let bubbleBorder: string = isSelected ? "0" : "2px solid var(--slate-300)"
                  let bubbleShadow: string = isSelected
                    ? "0 6px 12px -4px rgba(220, 38, 38, 0.45)"
                    : "none"
                  let boxShadow: string = isSelected
                    ? "0 8px 18px -10px rgba(249, 115, 22, 0.4)"
                    : "none"
                  let trailingIcon: React.ReactNode = null

                  if (showFeedback) {
                    const isCorrect = opt.id === q.correctOptionId
                    if (isCorrect) {
                      borderColor = "var(--green)"
                      background  = "rgba(34, 197, 94, 0.10)"
                      bubbleBg    = "var(--green)"
                      bubbleColor = "#fff"
                      bubbleBorder = "0"
                      bubbleShadow = "0 6px 12px -4px rgba(34, 197, 94, 0.45)"
                      boxShadow   = "0 8px 18px -10px rgba(34, 197, 94, 0.4)"
                      trailingIcon = <CheckCircle2 className="h-5 w-5 flex-shrink-0 mt-1" style={{ color: "var(--green)" }} />
                    } else if (isSelected) {
                      // seleccionada y NO correcta
                      borderColor = "var(--red-500)"
                      background  = "rgba(239, 68, 68, 0.10)"
                      bubbleBg    = "var(--red-500)"
                      bubbleColor = "#fff"
                      bubbleBorder = "0"
                      bubbleShadow = "0 6px 12px -4px rgba(239, 68, 68, 0.45)"
                      boxShadow   = "0 8px 18px -10px rgba(239, 68, 68, 0.4)"
                      trailingIcon = <XCircle className="h-5 w-5 flex-shrink-0 mt-1" style={{ color: "var(--red-500)" }} />
                    } else {
                      // Resto: atenuar
                      borderColor = "var(--slate-200)"
                      background  = "#fff"
                      bubbleBg    = "transparent"
                      bubbleColor = "var(--slate-400)"
                      bubbleBorder = "2px solid var(--slate-200)"
                      bubbleShadow = "none"
                      boxShadow   = "none"
                    }
                  }

                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => selectOption(opt.id)}
                      className="w-full text-left transition flex items-start gap-3"
                      style={{
                        padding: 14,
                        borderRadius: 14,
                        border: `2px solid ${borderColor}`,
                        background,
                        boxShadow,
                      }}
                    >
                      <span
                        className="flex-shrink-0 flex items-center justify-center font-bold"
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: "50%",
                          fontSize: 14,
                          background: bubbleBg,
                          color: bubbleColor,
                          border: bubbleBorder,
                          boxShadow: bubbleShadow,
                        }}
                      >
                        {opt.letra}
                      </span>
                      <span className="leading-snug pt-1.5 flex-1" style={{ fontSize: 15 }}>
                        {opt.texto}
                      </span>
                      {trailingIcon}
                      <kbd
                        className="hidden md:inline-block flex-shrink-0 mt-1"
                        style={{
                          fontSize: 10,
                          color: "var(--slate-400)",
                          border: "1px solid var(--slate-200)",
                          borderRadius: 4,
                          padding: "1px 6px",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {hint}
                      </kbd>
                    </button>
                  )
                })}
              </div>

              {/* Banner de feedback en modo práctica */}
              {showFeedback && (
                <div
                  style={{
                    marginTop: 14,
                    borderRadius: 12,
                    padding: "12px 14px",
                    background: selectedIsCorrect
                      ? "rgba(34, 197, 94, 0.10)"
                      : "rgba(239, 68, 68, 0.10)",
                    border: `1px solid ${
                      selectedIsCorrect ? "rgba(34, 197, 94, 0.35)" : "rgba(239, 68, 68, 0.35)"
                    }`,
                    color: selectedIsCorrect ? "var(--green-d)" : "var(--red-600)",
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 14,
                  }}
                >
                  {selectedIsCorrect ? (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      ¡Correcto!
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4" />
                      Incorrecto — la respuesta correcta está marcada en verde.
                    </>
                  )}
                </div>
              )}

              {/* IA: solo en práctica, solo logueados y con quota */}
              {showFeedback && aiQuota > 0 && q.explicacion && (
                <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <AIExplainPanel
                    questionId={q.id}
                    explicacion={q.explicacion ?? ""}
                    hasImage={Boolean(q.imagen)}
                    remaining={aiRemaining}
                    maxAllowed={aiQuota}
                    options={q.options.map((o) => ({ letra: o.letra, texto: o.texto }))}
                    correctLetra={
                      q.correctOptionId
                        ? q.options.find((o) => o.id === q.correctOptionId)?.letra
                        : undefined
                    }
                    onConsume={(cached) => {
                      // Las respuestas cacheadas no descuentan quota
                      if (!cached) setAiRemaining((r) => Math.max(0, r - 1))
                    }}
                    onResult={(res) => {
                      setAiResults((prev) => ({ ...prev, [q.id]: res }))
                    }}
                  />
                </div>
              )}

              {/* Explicación expandible */}
              {showFeedback && q.explicacion && (
                <details
                  style={{
                    marginTop: 8,
                    padding: "10px 14px",
                    background: "rgba(245, 158, 11, 0.08)",
                    borderRadius: 10,
                    border: "1px solid rgba(245, 158, 11, 0.25)",
                  }}
                  open={Boolean(aiResults[q.id])}
                >
                  <summary
                    style={{
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: 13,
                      color: "var(--amber-d)",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Ver explicación
                  </summary>
                  {aiResults[q.id] ? (
                    <div style={{ marginTop: 8 }}>
                      <ExplanationWithHighlights
                        text={q.explicacion ?? ""}
                        highlights={aiResults[q.id].keyPhrases}
                      />
                    </div>
                  ) : (
                    <p style={{ marginTop: 8, marginBottom: 0, fontSize: 13.5, lineHeight: 1.55 }}>
                      {q.explicacion}
                    </p>
                  )}
                </details>
              )}
            </div>
          </div>
      </div>

      {/* Controles de navegación */}
      <div className="flex items-center justify-between gap-4">
        <Button
          variant="outline"
          onClick={() => goTo(current - 1)}
          disabled={current === 0 || isPending}
        >
          <ArrowLeft className="h-4 w-4" />
          Anterior
          <kbd className="hidden md:inline-block text-[10px] text-slate-400 ml-1">←</kbd>
        </Button>

        <div className="flex items-center gap-2">
          <Dialog open={mapOpen} onOpenChange={setMapOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <LayoutGrid className="h-4 w-4" />
                Mapa
                <kbd className="hidden md:inline-block text-[10px] text-slate-400 ml-1">M</kbd>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Mapa de preguntas</DialogTitle>
                <DialogDescription className="sr-only">
                  Cuadrícula con todas las preguntas del test para saltar entre ellas.
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-6 gap-2 mt-2">
                {questions.map((qu, i) => {
                  const isAnswered = (answers[qu.id] ?? null) !== null
                  const isCurrent = i === current
                  return (
                    <button
                      key={qu.id}
                      type="button"
                      onClick={() => {
                        goTo(i)
                        setMapOpen(false)
                      }}
                      className={`aspect-square rounded text-sm font-medium border-2 transition ${
                        isCurrent
                          ? "border-slate-900 bg-slate-900 text-white"
                          : isAnswered
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {i + 1}
                    </button>
                  )
                })}
              </div>
              <div className="flex justify-between text-xs text-slate-500 pt-2">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 bg-emerald-50 border border-emerald-200 rounded" />
                  Respondida
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 bg-slate-50 border border-slate-200 rounded" />
                  Sin responder
                </span>
              </div>
            </DialogContent>
          </Dialog>

          <Button onClick={handleFinish} disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Corrigiendo...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Finalizar
                <kbd className="hidden md:inline-block text-[10px] text-emerald-100 ml-1">↵</kbd>
              </>
            )}
          </Button>
        </div>

        <Button
          variant="outline"
          onClick={() => goTo(current + 1)}
          disabled={current === total - 1 || isPending}
        >
          <kbd className="hidden md:inline-block text-[10px] text-slate-400 mr-1">→</kbd>
          Siguiente
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700 flex items-center gap-2">
          <XCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* Aviso final del temporizador */}
      {isExamMode && secondsLeft !== null && secondsLeft < 60 && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          ¡Menos de un minuto! El examen se enviará automáticamente cuando acabe el tiempo.
        </div>
      )}
    </div>
  )
}
