import { notFound } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { db } from "@/lib/db"
import { findManualSectionsForCodes } from "@/lib/manual"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ManualButton } from "@/components/ManualButton"
import {
  ChevronLeft,
  CheckCircle2,
  XCircle,
  Trophy,
  RotateCw,
  BookOpen,
  Lightbulb,
} from "lucide-react"

interface PageProps {
  params: Promise<{ categoria: string; testNum: string; attemptId: string }>
}

const PASS_THRESHOLD = 0.9   // 90% para aprobar (27/30)

export default async function ResultPage({ params }: PageProps) {
  const { categoria, testNum, attemptId } = await params
  const id = parseInt(attemptId, 10)
  if (Number.isNaN(id)) notFound()

  const attempt = await db.examAttempt.findUnique({
    where: { id },
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
      <Card className={passed ? "border-emerald-200 bg-emerald-50/30" : "border-amber-200 bg-amber-50/30"}>
        <CardContent className="p-6 flex flex-col md:flex-row md:items-center gap-6 justify-between">
          <div className="flex items-center gap-4">
            {passed ? (
              <Trophy className="h-12 w-12 text-emerald-500" />
            ) : (
              <RotateCw className="h-12 w-12 text-amber-500" />
            )}
            <div>
              <h1 className="text-2xl font-bold">
                {passed ? "¡Aprobado!" : "Necesitas mejorar"}
              </h1>
              <p className="text-slate-600">
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
              <div className="text-3xl font-bold font-mono">
                {score}<span className="text-slate-400">/{total}</span>
              </div>
              <div className="text-xs text-slate-500">Aciertos</div>
            </div>
            <div>
              <div className="text-3xl font-bold font-mono text-red-500">{wrong}</div>
              <div className="text-xs text-slate-500">Fallos</div>
            </div>
            {blanks > 0 && (
              <div>
                <div className="text-3xl font-bold font-mono text-slate-400">{blanks}</div>
                <div className="text-xs text-slate-500">Blancos</div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {attempt.test && (
              <Button asChild>
                <Link href={`/${attempt.test.category.slug}/${attempt.test.testNumber}`}>
                  <RotateCw className="h-4 w-4" />
                  Repetir test
                </Link>
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link href="/test-errores">
                <Lightbulb className="h-4 w-4" />
                Test de errores
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Detalle pregunta a pregunta */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          Revisión
        </h2>

        {orderedAnswers.map((a, idx) => {
          const correctOption = a.question.options.find((o) => o.isCorrect)
          const isCorrect = a.isCorrect
          const isBlank = a.selectedOptionId === null

          return (
            <Card
              key={a.id}
              className={
                isCorrect
                  ? "border-emerald-200"
                  : isBlank
                  ? "border-slate-300"
                  : "border-red-200"
              }
            >
              <CardContent className="p-5">
                <div className="grid gap-4 md:grid-cols-[200px_1fr]">
                  {/* Imagen */}
                  <div>
                    {a.question.imagen ? (
                      <div className="relative aspect-square bg-slate-100 rounded overflow-hidden">
                        <Image
                          src={`/images/${a.question.imagen}`}
                          alt={`Pregunta ${idx + 1}`}
                          fill
                          className="object-contain"
                          sizes="200px"
                        />
                      </div>
                    ) : (
                      <div className="aspect-square bg-slate-50 rounded flex items-center justify-center text-slate-300 text-xs">
                        sin imagen
                      </div>
                    )}
                    {a.question.codigoTema && (
                      <div className="text-xs text-slate-500 font-mono mt-2 text-center">
                        {a.question.codigoTema}
                      </div>
                    )}
                  </div>

                  {/* Texto + opciones */}
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <Badge
                        variant={isCorrect ? "default" : "destructive"}
                        className="text-base font-bold"
                      >
                        {idx + 1}
                      </Badge>
                      {isCorrect ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0 mt-1" />
                      ) : isBlank ? (
                        <XCircle className="h-5 w-5 text-slate-400 flex-shrink-0 mt-1" />
                      ) : (
                        <XCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-1" />
                      )}
                      <h3 className="text-base font-medium leading-snug">
                        {a.question.enunciado}
                      </h3>
                    </div>

                    {/* Opciones */}
                    <div className="space-y-1.5">
                      {a.question.options.map((opt) => {
                        const isSelectedByUser = a.selectedOptionId === opt.id
                        const isTheCorrect = opt.isCorrect
                        let cls = "border-slate-200 bg-white"
                        if (isTheCorrect) cls = "border-emerald-300 bg-emerald-50"
                        else if (isSelectedByUser) cls = "border-red-300 bg-red-50"
                        return (
                          <div
                            key={opt.id}
                            className={`p-2.5 rounded border flex items-center gap-2 text-sm ${cls}`}
                          >
                            <span
                              className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center font-bold text-xs ${
                                isTheCorrect
                                  ? "border-emerald-500 bg-emerald-500 text-white"
                                  : isSelectedByUser
                                  ? "border-red-500 bg-red-500 text-white"
                                  : "border-slate-300 text-slate-500"
                              }`}
                            >
                              {opt.letra}
                            </span>
                            <span className="flex-1">{opt.texto}</span>
                            {isTheCorrect && (
                              <Badge variant="outline" className="text-emerald-700 border-emerald-300 text-xs">
                                correcta
                              </Badge>
                            )}
                            {isSelectedByUser && !isTheCorrect && (
                              <Badge variant="outline" className="text-red-700 border-red-300 text-xs">
                                tu respuesta
                              </Badge>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {/* Acciones: explicación + manual */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {a.question.codigoTema && manualByCodigo.get(a.question.codigoTema) && (
                        <ManualButton section={manualByCodigo.get(a.question.codigoTema)!} />
                      )}
                    </div>

                    {/* Explicación */}
                    {a.question.explicacion && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-sm font-medium text-slate-700 hover:text-slate-900 select-none">
                          Ver explicación
                        </summary>
                        <div className="mt-2 p-3 rounded bg-slate-50 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                          {a.question.explicacion}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
