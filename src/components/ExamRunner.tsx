"use client"

import { useState, useTransition, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
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
import { QuestionReportButton } from "@/components/QuestionReportButton"
import {
  loadExamState,
  saveExamState,
  clearExamState,
  type SavedExamState,
} from "@/lib/examState"
import { triggerXpGainAnimation } from "@/lib/xpAnimation"
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
  mode?: "normal" | "errores" | "errores-refuerzo" | "tema"
  /** Duración en segundos del temporizador. null = sin tiempo. */
  timeLimit?: number | null
  /** Si true, corregir en cliente y enviar a /preview-results en vez de POST /api/attempts. */
  isGuest?: boolean
  /** Máximo mensual de tokens IA (10 free, 50 pro). 0 = sin acceso (guests). */
  aiQuota?: number
  /** Tokens IA restantes este mes (estado real). Si no se pasa, se usa aiQuota. */
  aiQuotaRemaining?: number
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0")
  const s = (seconds % 60).toString().padStart(2, "0")
  return `${m}:${s}`
}

export function ExamRunner({
  data,
  mode = "normal",
  timeLimit = null,
  isGuest = false,
  aiQuota = 0,
  aiQuotaRemaining,
}: ExamRunnerProps) {
  const router = useRouter()
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<Record<number, number | null>>({})
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // Ref a la última versión de `handleFinish` — necesario para que el
  // botón DEV pueda dispararlo DESPUÉS de hacer setAnswers (que es
  // async). Sin esta indirección la closure capturaría el handleFinish
  // viejo con `answers` vacío.
  const handleFinishRef = useRef<(() => void) | null>(null)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(timeLimit)
  // En modo práctica (timeLimit===null) corre un cronómetro hacia ARRIBA
  // contando tiempo transcurrido. Reemplaza el "no hay timer" que había
  // antes: aunque no haya límite, ver cuánto llevas es útil de cara al
  // examen real (que sí tiene 30 min para 30 preguntas).
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0)
  const [mapOpen, setMapOpen] = useState(false)
  const [aiRemaining, setAiRemaining] = useState(aiQuotaRemaining ?? aiQuota)
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
  // El setHydrated dispara una re-render, pero solo PASA UNA VEZ por mount
  // gracias al ref. Es un patrón de hidratación legítimo, no un anti-pattern.
  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    if (!isResumable) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
      } else {
        // Modo práctica: el cronómetro hacia arriba parte del tiempo ya
        // transcurrido desde que se inició la sesión original.
        const elapsed = Math.floor((Date.now() - new Date(saved.startedAt).getTime()) / 1000)
        setElapsedSeconds(Math.max(0, elapsed))
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

    // "Examen real" = mode normal + cronómetro. Lo necesita el endpoint
    // para decidir si conceder XP base por examen (solo en exámenes
    // reales). Práctica desde un test, /temas o /test-errores no da XP
    // base — solo el bonus diario de racha si el modo cuenta para stats.
    const isRealExam = mode === "normal" && timeLimit !== null

    const payload: SubmitAttemptPayload = {
      testId: test.id,
      mode,
      isRealExam,
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
        // Dispara la animación de XP gain (bubble + pelotitas) UNA sola
        // vez con el total combinado base+bonus. La función helper
        // garantiza idempotencia — el endpoint ya devuelve la suma en
        // `data.xp.awarded`, no hay dos eventos separados.
        const fired = triggerXpGainAnimation(data.xp)
        if (!fired && data.xp?.awarded > 0) {
          // Fallback: storage no disponible (modo incógnito raro) →
          // toast simple para no perder el feedback.
          toast.success(`+${data.xp.awarded} XP`, {
            description: `Nivel ${data.xp.newLevel} · ${data.xp.levelLabel}`,
            duration: 3500,
          })
        }
        // El level-up sigue mostrándose como toast prominente además
        // de la animación de la barra — es un evento celebratorio.
        if (data.xp?.leveledUp) {
          toast.success(
            `¡Subes a nivel ${data.xp.newLevel}! · ${data.xp.levelLabel}`,
            {
              description: `+${data.xp.awarded} XP en este examen`,
              duration: 6000,
            },
          )
        }
        router.push(data.redirectUrl)
      } catch (err) {
        submittedRef.current = false
        setError(err instanceof Error ? err.message : "Error desconocido")
      }
    })
  }, [answers, isGuest, mode, questions, router, test.id, test.testNumber, test.category])

  // Sincroniza el ref con la última versión de handleFinish. El cheat
  // mode dev necesita disparar handleFinish DESPUÉS de setAnswers, y
  // sin este ref capturaría una versión vieja vía closure. Lo hacemos
  // en un effect (no en render) para no romper la regla de "no mutar
  // refs durante render" — siempre corre tras commit.
  useEffect(() => {
    handleFinishRef.current = handleFinish
  })

  /**
   * DEV ONLY: rellena las respuestas con un `targetCorrect` exacto de
   * aciertos (el resto, errores) y dispara `handleFinish`. Atajo para
   * iterar la UI de la bubble XP sin contestar 30 preguntas y forzando
   * scores conocidos (100%, 27/30, 50%, 0%).
   *
   * Requiere que el server haya shipeado `correctOptionId` por pregunta
   * (lo hace cuando NODE_ENV=development, ver page.tsx → sendSolutions).
   * Si por alguna razón no está, cae a "primera opción" como wrong y
   * "primera opción" como correct — score impredecible, pero al menos
   * no peta.
   */
  const devFinishWithScore = useCallback((targetCorrect: number) => {
    if (process.env.NODE_ENV !== "development") return
    // Decidimos QUÉ índices serán correctos via shuffle Fisher-Yates de
    // las posiciones [0, n). Los primeros `targetCorrect` indices del
    // shuffle marcamos como correctas. Así el score = targetCorrect
    // exacto, no aproximado.
    const indices = questions.map((_, i) => i)
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[indices[i], indices[j]] = [indices[j], indices[i]]
    }
    const correctIdxSet = new Set(indices.slice(0, targetCorrect))

    const next: Record<number, number | null> = {}
    questions.forEach((qu, i) => {
      const correctId = qu.correctOptionId ?? null
      if (correctIdxSet.has(i)) {
        // Acierto: elige la opción correcta si la sabemos; si no, una
        // cualquiera (mejor que dejar null).
        next[qu.id] = correctId ?? qu.options[0]?.id ?? null
      } else {
        // Fallo: elige una opción que NO sea la correcta. Si no sabemos
        // cuál es la correcta, escoge una al azar y asume que cuenta.
        const wrongOpts = correctId != null
          ? qu.options.filter((o) => o.id !== correctId)
          : qu.options
        const pick = wrongOpts[Math.floor(Math.random() * wrongOpts.length)]
        next[qu.id] = pick?.id ?? null
      }
    })
    setAnswers(next)
    // Esperar a que React commit el setAnswers + cree la nueva closure
    // de handleFinish, luego dispararla vía ref.
    window.setTimeout(() => handleFinishRef.current?.(), 60)
  }, [questions])

  // ── Temporizador ────────────────────────────────────────────────────────
  // Patrón estándar de countdown: el setTimeout dispara el setSecondsLeft
  // FUERA del render (no es sincrónico, ergo no causa cascadas). El
  // handleFinish() al llegar a 0 termina el ciclo del effect, también safe.
  // La regla react-hooks/set-state-in-effect es demasiado estricta aquí.
  useEffect(() => {
    if (secondsLeft === null) return
    if (secondsLeft <= 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      handleFinish()
      return
    }
    const id = setTimeout(

      () => setSecondsLeft((s) => (s === null ? null : s - 1)),
      1000
    )
    return () => clearTimeout(id)
  }, [secondsLeft, handleFinish])

  // Cronómetro hacia ARRIBA — solo activo en modo práctica (sin límite)
  // y tras hidratar para no doblar el conteo cuando se restaura un saved.
  useEffect(() => {
    if (timeLimit !== null || !hydrated) return
    const id = setTimeout(

      () => setElapsedSeconds((s) => s + 1),
      1000,
    )
    return () => clearTimeout(id)
  }, [elapsedSeconds, timeLimit, hydrated])

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
      {/* ── DEV-only cheat pills ──────────────────────────────────────
          Botonera flotante con 4 atajos: cada pill rellena con un score
          exacto y dispara finalizar. Solo aparece en NODE_ENV=development,
          así que en producción ni siquiera entra al bundle (Next/Turbopack
          hace tree-shake por la rama if). El cálculo del score depende de
          que el server haya shipeado `correctOptionId` por pregunta, lo
          cual también gateamos por NODE_ENV server-side. */}
      {process.env.NODE_ENV === "development" && !isPending && (
        <div
          role="group"
          aria-label="Atajos DEV: forzar score y finalizar"
          style={{
            position:     "fixed",
            top:          82,
            right:        16,
            zIndex:       9500,
            display:      "inline-flex",
            gap:          6,
            padding:      "4px 4px",
            borderRadius: 10,
            background:   "rgba(15, 23, 42, 0.92)",
            border:       "1px solid rgba(255,255,255,0.12)",
            boxShadow:    "0 10px 24px -10px rgba(0,0,0,0.55)",
            backdropFilter: "blur(6px)",
          }}
        >
          {([
            { label: "100%", target: questions.length,     bg: "#16a34a" }, // verde
            { label: "27/30", target: Math.max(questions.length - 3, 0), bg: "#0ea5e9" }, // azul
            { label: "50%",  target: Math.floor(questions.length / 2), bg: "#f59e0b" }, // amber
            { label: "0%",   target: 0,                    bg: "#ef4444" }, // rojo
          ] as const).map(({ label, target, bg }) => (
            <button
              key={label}
              type="button"
              onClick={() => devFinishWithScore(target)}
              title={`DEV: forzar ${target}/${questions.length} aciertos y finalizar`}
              style={{
                background:   bg,
                color:        "#fff",
                padding:      "5px 9px",
                fontSize:     11,
                fontWeight:   800,
                borderRadius: 6,
                cursor:       "pointer",
                border:       "1px solid rgba(255,255,255,0.18)",
                letterSpacing: "0.02em",
                lineHeight:   1,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {/* Header con progreso y timer */}
      <div className="space-y-2">
        {/*
          Stack vertical en mobile (nombre arriba, progreso abajo) para
          evitar que el otro flex-shrink-0 colapse el nombre del examen
          a 3px. En sm+ vuelve a fila como antes (desktop intacto).
        */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-4 text-sm text-slate-600">
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
            {!isExamMode && hydrated && (
              <span
                className="flex items-center gap-1 font-mono font-semibold text-slate-700"
                title="Tiempo transcurrido en esta práctica"
              >
                <Timer className="h-4 w-4" />
                {formatTime(elapsedSeconds)}
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
              {/* Botón "Reportar incidencia" — solo en modo práctica tras
                  corregir la pregunta. Centrado debajo del TC para que sea
                  descubrible sin estorbar el flujo de responder. */}
              {showFeedback && (
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <QuestionReportButton questionId={q.id} isGuest={isGuest} variant="text" />
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
                <h2 className="text-lg font-semibold leading-snug m-0">
                  {q.enunciado}
                  {q.aiGenerated && (
                    <span
                      title="Esta pregunta fue generada por IA, revisada y aprobada por un admin"
                      style={{
                        marginLeft:   8,
                        display:      "inline-flex",
                        alignItems:   "center",
                        gap:          3,
                        padding:      "2px 7px",
                        borderRadius: 999,
                        background:   "rgba(168, 85, 247, 0.10)",
                        border:       "1px solid rgba(168, 85, 247, 0.30)",
                        color:        "rgb(126, 34, 206)",
                        fontSize:     10.5,
                        fontWeight:   800,
                        letterSpacing: "0.04em",
                        verticalAlign: "middle",
                        cursor:       "help",
                      }}
                    >
                      ✨ IA
                    </span>
                  )}
                </h2>
                <QuestionReportButton questionId={q.id} isGuest={isGuest} />
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
                    onConsume={() => {
                      // Tanto cache hit como miss descuentan ya en server,
                      // sincronizamos el contador local
                      setAiRemaining((r) => Math.max(0, r - 1))
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
          aria-label="Anterior"
        >
          <ArrowLeft className="h-4 w-4" />
          {/* En mobile sólo el icono — el texto se sale del flex y desborda
              la página entera. En sm+ vuelve a verse "Anterior". */}
          <span className="hidden sm:inline">Anterior</span>
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
              {/* 5 columnas en pantallas <380px (30 preguntas en 6 filas);
                  6 columnas en sm+ (igual que antes en desktop). */}
              <div className="grid grid-cols-5 sm:grid-cols-6 gap-1.5 sm:gap-2 mt-2">
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

          <Button
            onClick={handleFinish}
            disabled={isPending}
            size="lg"
            className={`exam-finish-btn px-6 ${answered === total ? "exam-finish-btn--ready" : ""}`}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Corrigiendo...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-5 w-5" />
                Finalizar
                <kbd className="hidden md:inline-block text-[10px] text-emerald-50/90 ml-1">↵</kbd>
              </>
            )}
          </Button>
        </div>

        <Button
          variant="outline"
          onClick={() => goTo(current + 1)}
          disabled={current === total - 1 || isPending}
          aria-label="Siguiente"
        >
          <kbd className="hidden md:inline-block text-[10px] text-slate-400 mr-1">→</kbd>
          {/* En mobile sólo el icono — ídem que el "Anterior". */}
          <span className="hidden sm:inline">Siguiente</span>
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
