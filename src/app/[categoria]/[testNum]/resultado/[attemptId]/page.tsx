import { notFound } from "next/navigation"
import Link from "next/link"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { findManualSectionsForCodes } from "@/lib/manual"
import { Badge } from "@/components/ui/badge"
import { ManualButton } from "@/components/ManualButton"
import { QuestionImage } from "@/components/QuestionImage"
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
} from "lucide-react"

interface PageProps {
  params: Promise<{ categoria: string; testNum: string; attemptId: string }>
}

const PASS_THRESHOLD = 0.9   // 90% para aprobar (27/30)

export default async function ResultPage({ params }: PageProps) {
  const user = await requireUser()
  const { categoria, testNum, attemptId } = await params
  const id = parseInt(attemptId, 10)
  if (Number.isNaN(id)) notFound()

  const attempt = await db.examAttempt.findFirst({
    where: { id, userId: user.id },
    include: {
      test: { include: { category: true } },
      answers: {
        include: {
          question: {
            include: {
              options: { orderBy: { letra: "asc" } },
            },
          },
          selectedOption: true,
        },
      },
    },
  })

  if (!attempt) notFound()
  if (attempt.test && attempt.test.category.slug !== categoria) notFound()

  // Re-ordenar las respuestas según el orden en el test
  let orderedAnswers = attempt.answers
  if (attempt.testId) {
    const testQs = await db.testQuestion.findMany({
      where: { testId: attempt.testId },
      orderBy: { order: "asc" },
      select: { questionId: true, order: true },
    })
    const orderMap = new Map(testQs.map((tq) => [tq.questionId, tq.order]))
    orderedAnswers = [...attempt.answers].sort(
      (a, b) => (orderMap.get(a.questionId) ?? 0) - (orderMap.get(b.questionId) ?? 0)
    )
  }

  const score = attempt.score ?? 0
  const total = attempt.total
  const wrong = total - score
  const blanks = orderedAnswers.filter((a) => a.selectedOptionId === null).length
  const ratio = score / total
  const passed = ratio >= PASS_THRESHOLD

  // Cargar secciones del manual asociadas a cada pregunta (en una sola query)
  const codigos = orderedAnswers.map((a) => a.question.codigoTema)
  const manualByCodigo = await findManualSectionsForCodes(codigos)

  return (
    <div className="space-y-6">
      <Link
        href={attempt.test ? `/${attempt.test.category.slug}` : "/"}
        className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
      >
        <ChevronLeft className="h-4 w-4" />
        {attempt.test ? `Volver a ${attempt.test.category.name}` : "Inicio"}
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
                {attempt.test
                  ? `${attempt.test.category.name} · Test ${attempt.test.testNumber}`
                  : "Test de errores"}
                {" · "}
                {attempt.startedAt.toLocaleString("es-ES")}
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
            {attempt.test && (
              <Link href={`/${attempt.test.category.slug}/${attempt.test.testNumber}`} className="btn-primary">
                <RotateCw className="h-4 w-4" />
                Repetir test
              </Link>
            )}
            <Link href="/test-errores" className="btn-secondary">
              <Lightbulb className="h-4 w-4" />
              Test de errores
            </Link>
          </div>
        </div>
      </div>

      {/* Detalle pregunta a pregunta */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          Revisión
        </h2>

        {orderedAnswers.map((a, idx) => {
          const isCorrect = a.isCorrect
          const isBlank = a.selectedOptionId === null
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

                  {/* Banner correcto / incorrecto / sin responder (estilo práctica) */}
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

                  {/* Explicación expandible (estilo práctica) */}
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
