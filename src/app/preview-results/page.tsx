"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { imageUrl } from "@/lib/imageUrl"
import {
  CheckCircle2,
  XCircle,
  ChevronLeft,
  Sparkles,
  UserPlus,
  LogIn,
  Trophy,
  Target,
  RotateCw,
} from "lucide-react"

interface AnswerDetail {
  questionId:       number
  enunciado:        string
  imagen:           string | null
  codigoTema:       string | null
  options:          { id: number; letra: string; texto: string }[]
  correctOptionId:  number | null
  selectedOptionId: number | null
  isCorrect:        boolean
  explicacion:      string | null
}

interface GuestResult {
  test: {
    id:         number
    testNumber: number
    category:   { slug: string; name: string; code: string }
  }
  score:      number
  total:      number
  mode:       "normal" | "errores"
  finishedAt: string
  answers:    AnswerDetail[]
}

const PASS_THRESHOLD = 0.9

export default function PreviewResultsPage() {
  const router = useRouter()
  const [result, setResult] = useState<GuestResult | null>(null)
  const [loaded, setLoaded] = useState(false)

  // Mount-once effect que lee sessionStorage para hidratar el resultado
  // del invitado tras submit del test. Los setState aquí son intencionales
  // (es el camino normal de hidratación SSR→client). Desactivamos
  // react-hooks/set-state-in-effect para todo el bloque del effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("dgt:guest-result")
      if (!raw) {
        setLoaded(true)
        return
      }
      const parsed = JSON.parse(raw) as GuestResult
      setResult(parsed)
    } catch {
      // ignore
    } finally {
      setLoaded(true)
    }
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!loaded) {
    return (
      <div className="card-soft" style={{ padding: 40, textAlign: "center" }}>
        <p style={{ color: "var(--slate-500)" }}>Cargando…</p>
      </div>
    )
  }

  if (!result) {
    return (
      <div>
        <header className="page-header">
          <div>
            <h1>Sin resultados</h1>
            <p className="lead">No hay ningún resultado para mostrar.</p>
          </div>
        </header>
        <div className="card-soft" style={{ padding: 24 }}>
          <p style={{ marginTop: 0 }}>
            Los resultados de invitado se guardan temporalmente en este navegador.
            Si has cerrado la pestaña o recargado, ya no están disponibles.
          </p>
          <Link href="/" className="btn-primary">
            <ChevronLeft className="h-4 w-4" />
            Volver al inicio
          </Link>
        </div>
      </div>
    )
  }

  const ratio = result.score / result.total
  const passed = ratio >= PASS_THRESHOLD
  const percent = Math.round(ratio * 100)

  return (
    <div className="space-y-6">
      <Link href={`/${result.test.category.slug}`} className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Volver a {result.test.category.name}
      </Link>

      {/* Resumen */}
      <header
        className={`card-soft ${passed ? "" : "warm"}`}
        style={{ padding: 28 }}
      >
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div
              style={{
                fontSize: 11.5,
                color: "var(--slate-500)",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {result.test.category.name} · Test {result.test.testNumber} · Modo invitado
            </div>
            <h1 style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              {passed ? (
                <>
                  <Trophy className="h-7 w-7" style={{ color: "var(--green)" }} />
                  ¡Aprobado!
                </>
              ) : (
                <>
                  <Target className="h-7 w-7" style={{ color: "var(--amber)" }} />
                  Sigue practicando
                </>
              )}
            </h1>
          </div>
          <div className="text-right">
            <div
              className="font-mono-tabular"
              style={{
                fontSize: 56,
                fontWeight: 900,
                letterSpacing: "-0.03em",
                lineHeight: 1,
                color: passed ? "var(--green)" : ratio >= 0.7 ? "var(--amber)" : "var(--red-500)",
              }}
            >
              {result.score}/{result.total}
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 14,
                fontWeight: 700,
                color: "var(--slate-500)",
              }}
            >
              {percent}% de aciertos
            </div>
          </div>
        </div>
      </header>

      {/* CTA registro */}
      <section
        className="card-soft warm"
        style={{
          padding: 22,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 240 }}>
          <p style={{ margin: 0, marginBottom: 6, display: "flex", alignItems: "center", gap: 8, fontWeight: 800 }}>
            <Sparkles className="h-4 w-4" style={{ color: "var(--amber)" }} />
            Tu progreso no se ha guardado
          </p>
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--slate-600)" }}>
            Crea una cuenta gratis para guardar tu historial, ver estadísticas por tema, hacer
            el modo examen con cronómetro y repasar tus errores.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/register" className="btn-primary">
            <UserPlus className="h-4 w-4" />
            Crear cuenta
          </Link>
          <Link href="/login" className="btn-secondary">
            <LogIn className="h-4 w-4" />
            Iniciar sesión
          </Link>
        </div>
      </section>

      {/* Acciones */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link
          href={`/${result.test.category.slug}/${result.test.testNumber}?mode=practica`}
          className="btn-secondary"
        >
          <RotateCw className="h-4 w-4" />
          Repetir test
        </Link>
        <Link href={`/${result.test.category.slug}`} className="btn-secondary">
          Otros tests
        </Link>
      </div>

      {/* Respuestas */}
      <section>
        <div className="dash-section-title" style={{ margin: "8px 4px 14px" }}>
          <h3>Revisión de respuestas</h3>
        </div>
        <div className="space-y-4">
          {result.answers.map((a, i) => (
            <AnswerCard key={a.questionId} answer={a} index={i + 1} />
          ))}
        </div>
      </section>
    </div>
  )
}

function AnswerCard({ answer, index }: { answer: AnswerDetail; index: number }) {
  const unanswered = answer.selectedOptionId === null
  return (
    <div className="card-soft" style={{ padding: 20 }}>
      <div className="grid gap-4 md:grid-cols-[200px_1fr]">
        <div>
          {answer.imagen ? (
            <div className="relative aspect-square rounded-xl overflow-hidden" style={{ background: "var(--slate-100)" }}>
              <Image
                src={imageUrl(answer.imagen)}
                alt={`Pregunta ${index}`}
                fill
                className="object-contain"
                sizes="200px"
              />
            </div>
          ) : (
            <div
              className="aspect-square rounded-xl flex items-center justify-center text-sm"
              style={{ background: "var(--slate-100)", color: "var(--slate-300)" }}
            >
              sin imagen
            </div>
          )}
          {answer.codigoTema && (
            <div
              className="text-xs text-center font-mono-tabular"
              style={{ color: "var(--slate-500)", marginTop: 8 }}
            >
              {answer.codigoTema}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-start gap-3 mb-3">
            <span
              className="font-mono-tabular"
              style={{
                background: answer.isCorrect
                  ? "linear-gradient(180deg, #22c55e, #16a34a)"
                  : unanswered
                  ? "linear-gradient(180deg, var(--slate-400), var(--slate-500))"
                  : "linear-gradient(180deg, var(--red-500), var(--red-600))",
                color: "#fff",
                fontWeight: 800,
                fontSize: 14,
                padding: "4px 10px",
                borderRadius: 8,
                marginTop: 2,
              }}
            >
              {index}
            </span>
            <h3 className="text-base font-semibold leading-snug m-0">{answer.enunciado}</h3>
          </div>

          <div className="space-y-2">
            {answer.options.map((opt) => {
              const isCorrect = opt.id === answer.correctOptionId
              const isSelected = opt.id === answer.selectedOptionId
              const bg = isCorrect
                ? "rgba(34, 197, 94, 0.10)"
                : isSelected && !isCorrect
                ? "rgba(239, 68, 68, 0.10)"
                : "#fff"
              const border = isCorrect
                ? "2px solid var(--green)"
                : isSelected && !isCorrect
                ? "2px solid var(--red-500)"
                : "2px solid var(--slate-200)"
              return (
                <div
                  key={opt.id}
                  className="flex items-start gap-3"
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    border,
                    background: bg,
                  }}
                >
                  <span
                    className="flex-shrink-0 flex items-center justify-center font-bold"
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: "50%",
                      fontSize: 13,
                      background: isCorrect
                        ? "var(--green)"
                        : isSelected && !isCorrect
                        ? "var(--red-500)"
                        : "var(--slate-100)",
                      color: isCorrect || (isSelected && !isCorrect) ? "#fff" : "var(--slate-600)",
                    }}
                  >
                    {opt.letra}
                  </span>
                  <span className="leading-snug flex-1 pt-1" style={{ fontSize: 14 }}>
                    {opt.texto}
                  </span>
                  {isCorrect && (
                    <CheckCircle2 className="h-4 w-4 mt-1.5 flex-shrink-0" style={{ color: "var(--green)" }} />
                  )}
                  {isSelected && !isCorrect && (
                    <XCircle className="h-4 w-4 mt-1.5 flex-shrink-0" style={{ color: "var(--red-500)" }} />
                  )}
                </div>
              )
            })}
          </div>

          {answer.explicacion && (
            <details
              style={{
                marginTop: 12,
                padding: "10px 14px",
                background: "rgba(245, 158, 11, 0.08)",
                borderRadius: 10,
                border: "1px solid rgba(245, 158, 11, 0.25)",
              }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 13,
                  color: "var(--amber-d)",
                }}
              >
                Ver explicación
              </summary>
              <p style={{ marginTop: 8, marginBottom: 0, fontSize: 13.5, lineHeight: 1.55 }}>
                {answer.explicacion}
              </p>
            </details>
          )}

          {unanswered && (
            <p style={{ marginTop: 10, fontSize: 12.5, color: "var(--slate-500)", fontStyle: "italic" }}>
              No respondiste a esta pregunta.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
