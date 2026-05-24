import Link from "next/link"
import { db } from "@/lib/db"
import { findManualSectionsForCodes } from "@/lib/manual"
import { ManualButton } from "@/components/ManualButton"
import { QuestionImage } from "@/components/QuestionImage"
import { ResultsAIButton } from "@/components/ResultsAIButton"
import { QuestionReportButton } from "@/components/QuestionReportButton"
import type { AttemptMode } from "@/types/exam"
import {
  ChevronLeft,
  CheckCircle2,
  XCircle,
  Trophy,
  RotateCw,
  BookOpen,
  Lightbulb,
  Sparkles,
  MinusCircle,
  BookMarked,
} from "lucide-react"

const PASS_THRESHOLD = 0.9   // 90% para aprobar (27/30 en exámenes oficiales)

/**
 * Vista de revisión de un intento ya finalizado.
 *
 * Reutilizado por las dos rutas que muestran resultados:
 *   - /[categoria]/[testNum]/resultado/[attemptId]   → mode="normal"
 *   - /historial/[attemptId]                         → mode="errores" | "errores-refuerzo" | "tema"
 *
 * Antes existía una segunda implementación bare-bones embebida en
 * historial/[attemptId] solo para los modos sin test asociado, lo que
 * descuadraba la UX (titulada como "Test de errores" incluso para attempts
 * de modo "tema"). Ahora ambas rutas comparten esta vista y solo varía la
 * cabecera (icono, subtítulo y CTAs) según el modo.
 */

interface ReviewOption {
  id: number
  letra: string
  texto: string
  isCorrect: boolean
}

interface ReviewQuestion {
  id: number
  enunciado: string
  imagen: string | null
  codigoTema: string | null
  aiGenerated: boolean
  explicacion: string
  options: ReviewOption[]
}

export interface ReviewAnswer {
  id: number
  questionId: number
  selectedOptionId: number | null
  isCorrect: boolean
  question: ReviewQuestion
}

export interface AttemptReviewProps {
  attemptId: number
  userId:    number
  mode:      AttemptMode
  startedAt: Date
  score:     number
  total:     number
  /** Respuestas en el orden con el que se mostraron al usuario. */
  answers:   ReviewAnswer[]
  /** Test asociado (solo en mode="normal"); null en los modos sin test. */
  test: {
    testNumber: number
    category:   { slug: string; name: string }
  } | null
  /** Si true, muestra el id interno (#questionId) bajo el codigoTema. */
  isAdmin?:  boolean
}

export async function AttemptReview({
  attemptId,
  userId,
  mode,
  startedAt,
  score,
  total,
  answers,
  test,
  isAdmin = false,
}: AttemptReviewProps) {
  const wrong  = total - score
  const blanks = answers.filter((a) => a.selectedOptionId === null).length
  const ratio  = total > 0 ? score / total : 0
  const passed = ratio >= PASS_THRESHOLD

  // Secciones del manual asociadas a cada pregunta (una sola query)
  const codigos = answers.map((a) => a.question.codigoTema)
  const manualByCodigo = await findManualSectionsForCodes(codigos)

  // Pre-cargar qué (questionId, withImage) ya están pagadas en este attempt
  // para que el botón "Analizar con IA" aparezca como gratis sin esperar
  // a que el usuario abra el modal.
  const paidRows = await db.userAiPaid.findMany({
    where:  { userId, attemptId },
    select: { questionId: true, withImage: true },
  })
  const paidKey = (qId: number, wImg: boolean) => `${qId}:${wImg ? 1 : 0}`
  const paidSet = new Set(paidRows.map((p) => paidKey(p.questionId, p.withImage)))

  const header = headerForMode(mode, test)

  return (
    <div className="space-y-6">
      <Link
        href={header.backHref}
        className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
      >
        <ChevronLeft className="h-4 w-4" />
        {header.backLabel}
      </Link>

      {/* Resumen */}
      <div
        className="card-soft warm"
        style={{
          padding: 28,
          marginTop: 16,
          marginBottom: 22,
          borderColor: passed ? "rgba(34,197,94,0.35)" : "rgba(245,158,11,0.35)",
          background: passed
            ? "linear-gradient(120deg, rgba(34,197,94,0.10) 0%, #fff 60%)"
            : "linear-gradient(120deg, rgba(245,158,11,0.10) 0%, #fff 60%)",
        }}
      >
        <div className="flex flex-col md:flex-row md:items-center gap-6 justify-between">
          <div className="flex items-center gap-4">
            <div
              className="flex items-center justify-center rounded-2xl"
              style={{
                width: 64,
                height: 64,
                background: passed
                  ? "linear-gradient(135deg, var(--green), var(--green-d))"
                  : "linear-gradient(135deg, var(--amber), var(--orange-600))",
                color: "#fff",
                boxShadow: passed
                  ? "0 10px 22px -10px rgba(34,197,94,0.6)"
                  : "0 10px 22px -10px rgba(234,88,12,0.5)",
              }}
            >
              {passed ? <Trophy className="h-8 w-8" /> : <RotateCw className="h-8 w-8" />}
            </div>
            <div>
              <h1 className="text-2xl font-extrabold m-0" style={{ letterSpacing: "-0.02em" }}>
                {passed ? "¡Aprobado!" : "Necesitas mejorar"}
              </h1>
              <p className="m-0 mt-1" style={{ color: "var(--slate-500)", fontSize: 13.5, fontWeight: 500 }}>
                {header.subtitle}
                {" · "}
                {startedAt.toLocaleString("es-ES")}
              </p>
            </div>
          </div>

          <div className="flex gap-6 text-center">
            <div>
              <div className="font-mono-tabular" style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-0.03em" }}>
                {score}
                <span style={{ color: "var(--slate-400)" }}>/{total}</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--slate-500)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Aciertos</div>
            </div>
            <div>
              <div className="font-mono-tabular" style={{ fontSize: 32, fontWeight: 900, color: "var(--red-500)" }}>{wrong}</div>
              <div style={{ fontSize: 11, color: "var(--slate-500)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Fallos</div>
            </div>
            {blanks > 0 && (
              <div>
                <div className="font-mono-tabular" style={{ fontSize: 32, fontWeight: 900, color: "var(--slate-400)" }}>{blanks}</div>
                <div style={{ fontSize: 11, color: "var(--slate-500)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Blancos</div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {header.primaryAction && (
              <Link href={header.primaryAction.href} className="btn-primary">
                {header.primaryAction.icon}
                {header.primaryAction.label}
              </Link>
            )}
            {header.secondaryAction && (
              <Link href={header.secondaryAction.href} className="btn-secondary">
                {header.secondaryAction.icon}
                {header.secondaryAction.label}
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Detalle pregunta a pregunta */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          Revisión
        </h2>

        {answers.length === 0 && (
          <div
            className="card-soft"
            style={{
              padding: 20,
              borderColor: "rgba(245, 158, 11, 0.35)",
              background: "rgba(245, 158, 11, 0.06)",
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
            }}
          >
            <MinusCircle className="h-5 w-5 flex-shrink-0" style={{ color: "var(--amber-d)", marginTop: 2 }} />
            <div style={{ fontSize: 14, color: "var(--slate-700)", lineHeight: 1.55 }}>
              <b>No hay respuestas guardadas para revisar.</b>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--slate-600)" }}>
                Este intento se contabilizó en tu historial ({score}/{total}) pero las
                respuestas individuales se perdieron — posiblemente de una migración
                antigua. No es un bug actual; puedes seguir adelante repitiendo el test.
              </p>
            </div>
          </div>
        )}

        {answers.map((a, idx) => {
          const isCorrect = a.isCorrect
          const isBlank   = a.selectedOptionId === null
          const manualSection = a.question.codigoTema
            ? manualByCodigo.get(a.question.codigoTema)
            : undefined

          return (
            <div key={a.id} className="card-soft" style={{ padding: 20 }}>
              <div className="grid gap-4 md:grid-cols-[200px_1fr]">
                {/* Imagen (modal) */}
                <div>
                  <QuestionImage
                    src={a.question.imagen}
                    alt={`Pregunta ${idx + 1}`}
                    title={`Pregunta ${idx + 1}${a.question.codigoTema ? ` · ${a.question.codigoTema}` : ""}`}
                    size={200}
                  />
                  {a.question.codigoTema && (
                    <div
                      className="text-xs text-center font-mono-tabular"
                      style={{ color: "var(--slate-500)", marginTop: 8 }}
                    >
                      {a.question.codigoTema}
                    </div>
                  )}
                  {isAdmin && (
                    // Solo admin: id interno de la pregunta para depurar /
                    // referenciar rápido al revisarla. Mismo estilo que el
                    // codigoTema pero con prefijo `#` para distinguirlo.
                    <div
                      className="text-xs text-center font-mono-tabular"
                      style={{
                        color:      "var(--slate-400)",
                        marginTop:  4,
                        userSelect: "all",  // facilita copy/paste del id
                      }}
                      title="ID interno (solo visible para admin)"
                    >
                      #{a.question.id}
                    </div>
                  )}
                  {/* Botón discreto para reportar incidencia sobre esta
                      pregunta — útil tras ver el resultado, cuando el
                      usuario detecta una errata o algo raro. */}
                  <div style={{ display: "flex", justifyContent: "center", marginTop: 6 }}>
                    <QuestionReportButton questionId={a.question.id} variant="text" />
                  </div>
                </div>

                {/* Texto + opciones */}
                <div>
                  <div className="flex items-start gap-3 mb-3">
                    <span
                      className="font-mono-tabular"
                      style={{
                        background: isCorrect
                          ? "linear-gradient(180deg, #22c55e, #16a34a)"
                          : isBlank
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
                      {idx + 1}
                    </span>
                    <h3 className="text-base font-semibold leading-snug m-0">
                      {a.question.enunciado}
                      {a.question.aiGenerated && (
                        <span
                          title="Pregunta generada por IA, revisada por un admin"
                          className="font-mono-tabular"
                          style={{
                            marginLeft: 8,
                            padding: "2px 7px",
                            borderRadius: 999,
                            background: "rgba(168, 85, 247, 0.10)",
                            border: "1px solid rgba(168, 85, 247, 0.30)",
                            color: "rgb(126, 34, 206)",
                            fontSize: 10.5,
                            fontWeight: 800,
                            verticalAlign: "middle",
                            cursor: "help",
                          }}
                        >
                          ✨ IA
                        </span>
                      )}
                    </h3>
                  </div>

                  {/* Opciones */}
                  <div className="space-y-2">
                    {a.question.options.map((opt) => {
                      const isSelectedByUser = a.selectedOptionId === opt.id
                      const isTheCorrect = opt.isCorrect
                      const bg = isTheCorrect
                        ? "rgba(34, 197, 94, 0.10)"
                        : isSelectedByUser && !isTheCorrect
                        ? "rgba(239, 68, 68, 0.10)"
                        : "#fff"
                      const border = isTheCorrect
                        ? "2px solid var(--green)"
                        : isSelectedByUser && !isTheCorrect
                        ? "2px solid var(--red-500)"
                        : "2px solid var(--slate-200)"
                      return (
                        <div
                          key={opt.id}
                          className="flex items-start gap-3"
                          style={{ padding: 12, borderRadius: 12, border, background: bg }}
                        >
                          <span
                            className="flex-shrink-0 flex items-center justify-center font-bold"
                            style={{
                              width: 30,
                              height: 30,
                              borderRadius: "50%",
                              fontSize: 13,
                              background: isTheCorrect
                                ? "var(--green)"
                                : isSelectedByUser && !isTheCorrect
                                ? "var(--red-500)"
                                : "var(--slate-100)",
                              color:
                                isTheCorrect || (isSelectedByUser && !isTheCorrect)
                                  ? "#fff"
                                  : "var(--slate-600)",
                            }}
                          >
                            {opt.letra}
                          </span>
                          <span className="leading-snug flex-1 pt-1" style={{ fontSize: 14 }}>
                            {opt.texto}
                          </span>
                          {isTheCorrect && (
                            <CheckCircle2 className="h-4 w-4 mt-1.5 flex-shrink-0" style={{ color: "var(--green)" }} />
                          )}
                          {isSelectedByUser && !isTheCorrect && (
                            <XCircle className="h-4 w-4 mt-1.5 flex-shrink-0" style={{ color: "var(--red-500)" }} />
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Banner correcto / incorrecto / sin responder */}
                  <div
                    style={{
                      marginTop: 14,
                      borderRadius: 12,
                      padding: "12px 14px",
                      background: isCorrect
                        ? "rgba(34, 197, 94, 0.10)"
                        : isBlank
                        ? "rgba(148, 163, 184, 0.12)"
                        : "rgba(239, 68, 68, 0.10)",
                      border: `1px solid ${
                        isCorrect
                          ? "rgba(34, 197, 94, 0.35)"
                          : isBlank
                          ? "rgba(148, 163, 184, 0.35)"
                          : "rgba(239, 68, 68, 0.35)"
                      }`,
                      color: isCorrect
                        ? "var(--green-d)"
                        : isBlank
                        ? "var(--slate-600)"
                        : "var(--red-600)",
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 14,
                    }}
                  >
                    {isCorrect ? (
                      <>
                        <CheckCircle2 className="h-4 w-4" />
                        ¡Correcto!
                      </>
                    ) : isBlank ? (
                      <>
                        <MinusCircle className="h-4 w-4" />
                        No respondiste — la correcta está marcada en verde.
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4" />
                        Incorrecto — la respuesta correcta está marcada en verde.
                      </>
                    )}
                  </div>

                  {/* Manual */}
                  {manualSection && (
                    <div style={{ marginTop: 10 }}>
                      <ManualButton section={manualSection} />
                    </div>
                  )}

                  {/* Botón IA — quota compartida entre preguntas del mismo attempt */}
                  {a.question.explicacion && (
                    <ResultsAIButton
                      attemptId={attemptId}
                      questionId={a.question.id}
                      explicacion={a.question.explicacion}
                      hasImage={Boolean(a.question.imagen)}
                      options={a.question.options.map((o) => ({ letra: o.letra, texto: o.texto }))}
                      correctLetra={a.question.options.find((o) => o.isCorrect)?.letra}
                      initiallyPaid={paidSet.has(paidKey(a.question.id, Boolean(a.question.imagen)))}
                    />
                  )}

                  {/* Explicación expandible */}
                  {a.question.explicacion && (
                    <details
                      style={{
                        marginTop: 10,
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
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Ver explicación
                      </summary>
                      <p style={{ marginTop: 8, marginBottom: 0, fontSize: 13.5, lineHeight: 1.55 }}>
                        {a.question.explicacion}
                      </p>
                    </details>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface HeaderAction {
  href:  string
  label: string
  icon:  React.ReactNode
}

interface HeaderConfig {
  backHref:  string
  backLabel: string
  subtitle:  string
  primaryAction?:   HeaderAction
  secondaryAction?: HeaderAction
}

function headerForMode(
  mode: AttemptMode,
  test: AttemptReviewProps["test"]
): HeaderConfig {
  if (mode === "normal" && test) {
    return {
      backHref:  `/${test.category.slug}`,
      backLabel: `Volver a ${test.category.name}`,
      subtitle:  `${test.category.name} · Test ${test.testNumber}`,
      primaryAction: {
        href:  `/${test.category.slug}/${test.testNumber}`,
        label: "Repetir test",
        icon:  <RotateCw className="h-4 w-4" />,
      },
      secondaryAction: {
        href:  "/test-errores",
        label: "Test de errores",
        icon:  <Lightbulb className="h-4 w-4" />,
      },
    }
  }
  if (mode === "tema") {
    return {
      backHref:  "/temas",
      backLabel: "Volver a Temas",
      subtitle:  "Práctica por temas",
      primaryAction: {
        href:  "/temas",
        label: "Otro tema",
        icon:  <BookMarked className="h-4 w-4" />,
      },
      secondaryAction: {
        href:  "/test-errores",
        label: "Test de errores",
        icon:  <Lightbulb className="h-4 w-4" />,
      },
    }
  }
  // errores | errores-refuerzo
  return {
    backHref:  "/historial",
    backLabel: "Historial",
    subtitle:  mode === "errores-refuerzo"
      ? "Test de errores · refuerzo IA"
      : "Test de errores",
    primaryAction: {
      href:  "/test-errores",
      label: "Nuevo test de errores",
      icon:  <Lightbulb className="h-4 w-4" />,
    },
  }
}
