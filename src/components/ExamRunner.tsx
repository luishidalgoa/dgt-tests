"use client"

import { useState, useTransition, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  ArrowLeft,
  ArrowRight,
  LayoutGrid,
  CheckCircle2,
  XCircle,
  Loader2,
  Timer,
  AlertTriangle,
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
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0")
  const s = (seconds % 60).toString().padStart(2, "0")
  return `${m}:${s}`
}

export function ExamRunner({ data, mode = "normal", timeLimit = null }: ExamRunnerProps) {
  const router = useRouter()
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<Record<number, number | null>>({})
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(timeLimit)
  const [mapOpen, setMapOpen] = useState(false)
  const submittedRef = useRef(false)

  const { questions, test } = data
  const total = questions.length
  const q = questions[current]
  const selected = answers[q.id] ?? null
  const answered = Object.values(answers).filter((v) => v !== null).length

  // ── Submit ──────────────────────────────────────────────────────────────
  const handleFinish = useCallback(() => {
    if (submittedRef.current) return
    submittedRef.current = true
    setError(null)

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
        router.push(data.redirectUrl)
      } catch (err) {
        submittedRef.current = false
        setError(err instanceof Error ? err.message : "Error desconocido")
      }
    })
  }, [answers, mode, questions, router, test.id])

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
      <Card>
        <CardContent className="p-6">
          <div className="grid gap-6 md:grid-cols-[300px_1fr]">
            {/* Imagen */}
            <div className="space-y-3">
              {q.imagen ? (
                <div className="relative aspect-square bg-slate-100 rounded overflow-hidden">
                  <Image
                    src={`/images/${q.imagen}`}
                    alt={`Pregunta ${current + 1}`}
                    fill
                    className="object-contain"
                    sizes="300px"
                    priority
                  />
                </div>
              ) : (
                <div className="aspect-square bg-slate-50 rounded flex items-center justify-center text-slate-300 text-sm">
                  sin imagen
                </div>
              )}
              {q.codigoTema && (
                <div className="text-xs text-slate-500 font-mono text-center">
                  {q.codigoTema}
                </div>
              )}
            </div>

            {/* Enunciado + opciones */}
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Badge variant="secondary" className="text-base font-bold mt-0.5">
                  {current + 1}
                </Badge>
                <h2 className="text-lg font-medium leading-snug">{q.enunciado}</h2>
              </div>

              <div className="space-y-2 mt-4">
                {q.options.map((opt, i) => {
                  const isSelected = selected === opt.id
                  const hint = String.fromCharCode(65 + i) // A, B, C, D
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => selectOption(opt.id)}
                      className={`w-full text-left p-3 rounded-lg border transition flex items-start gap-3 ${
                        isSelected
                          ? "border-slate-900 bg-slate-100"
                          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className={`flex-shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-sm ${
                          isSelected
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-300 text-slate-600"
                        }`}
                      >
                        {opt.letra}
                      </span>
                      <span className="leading-snug pt-1 flex-1">{opt.texto}</span>
                      <kbd className="hidden md:inline-block flex-shrink-0 text-[10px] text-slate-400 border border-slate-200 rounded px-1.5 py-0.5 font-mono mt-1">
                        {hint}
                      </kbd>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

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
