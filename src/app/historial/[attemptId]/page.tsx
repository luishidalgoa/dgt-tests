import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { isAdmin } from "@/lib/permissions"
import { imageUrl } from "@/lib/imageUrl"
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
  Lightbulb,
  BookOpen,
} from "lucide-react"

interface PageProps {
  params: Promise<{ attemptId: string }>
}

const PASS_THRESHOLD = 0.9

export default async function HistoryDetailPage({ params }: PageProps) {
  const user = await requireUser()
  const admin = isAdmin(user)
  const { attemptId } = await params
  const id = parseInt(attemptId, 10)
  if (Number.isNaN(id)) notFound()

  const attempt = await db.examAttempt.findFirst({
    where: { id, userId: user.id },
    include: {
      test: { include: { category: true } },
      answers: {
        orderBy: { id: "asc" },
        include: {
          question: {
            include: {
              options: { orderBy: { letra: "asc" } },
            },
          },
        },
      },
    },
  })

  if (!attempt) notFound()

  // Si es un intento normal (con test), redirigir a la URL canónica
  if (attempt.test) {
    redirect(`/${attempt.test.category.slug}/${attempt.test.testNumber}/resultado/${attempt.id}`)
  }

  // Cargar manual asociado a cada pregunta
  const codigos = attempt.answers.map((a) => a.question.codigoTema)
  const manualByCodigo = await findManualSectionsForCodes(codigos)

  // A partir de aquí es un intento de "test de errores" sin test asociado
  const score = attempt.score ?? 0
  const total = attempt.total
  const wrong = total - score
  const blanks = attempt.answers.filter((a) => a.selectedOptionId === null).length
  const passed = score / total >= PASS_THRESHOLD

  return (
    <div className="space-y-6">
      <Link href="/historial" className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1">
        <ChevronLeft className="h-4 w-4" />
        Historial
      </Link>

      <Card className={passed ? "border-emerald-200 bg-emerald-50/30" : "border-amber-200 bg-amber-50/30"}>
        <CardContent className="p-6 flex flex-col md:flex-row md:items-center gap-6 justify-between">
          <div className="flex items-center gap-4">
            {passed ? (
              <Trophy className="h-12 w-12 text-emerald-500" />
            ) : (
              <Lightbulb className="h-12 w-12 text-amber-500" />
            )}
            <div>
              <h1 className="text-2xl font-bold">Test de errores</h1>
              <p className="text-slate-600">{attempt.startedAt.toLocaleString("es-ES")}</p>
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

          <Button asChild>
            <Link href="/test-errores">
              <Lightbulb className="h-4 w-4" />
              Nuevo test de errores
            </Link>
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          Revisión
        </h2>

        {attempt.answers.map((a, idx) => {
          const isCorrect = a.isCorrect
          const isBlank = a.selectedOptionId === null
          return (
            <Card
              key={a.id}
              className={
                isCorrect ? "border-emerald-200" : isBlank ? "border-slate-300" : "border-red-200"
              }
            >
              <CardContent className="p-5">
                <div className="grid gap-4 md:grid-cols-[200px_1fr]">
                  <div>
                    {a.question.imagen ? (
                      <div className="relative aspect-square bg-slate-100 rounded overflow-hidden">
                        <Image
                          src={imageUrl(a.question.imagen)}
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
                    {admin && (
                      // Solo admin: id interno de la pregunta para referenciar
                      // rápido al revisarla en /admin. userSelect:all facilita
                      // copy/paste del id (click triple selecciona).
                      <div
                        className="text-xs text-slate-400 font-mono mt-1 text-center"
                        title="ID interno (solo visible para admin)"
                        style={{ userSelect: "all" }}
                      >
                        #{a.questionId}
                      </div>
                    )}
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <Badge variant={isCorrect ? "default" : "destructive"} className="text-base font-bold">
                        {idx + 1}
                      </Badge>
                      {isCorrect ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0 mt-1" />
                      ) : (
                        <XCircle className={`h-5 w-5 ${isBlank ? "text-slate-400" : "text-red-500"} flex-shrink-0 mt-1`} />
                      )}
                      <h3 className="text-base font-medium leading-snug">
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

                    <div className="space-y-1.5">
                      {a.question.options.map((opt) => {
                        const isSelectedByUser = a.selectedOptionId === opt.id
                        const isTheCorrect = opt.isCorrect
                        let cls = "border-slate-200 bg-white"
                        if (isTheCorrect) cls = "border-emerald-300 bg-emerald-50"
                        else if (isSelectedByUser) cls = "border-red-300 bg-red-50"
                        return (
                          <div key={opt.id} className={`p-2.5 rounded border flex items-center gap-2 text-sm ${cls}`}>
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
                          </div>
                        )
                      })}
                    </div>

                    {/* Acciones: manual */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {a.question.codigoTema && manualByCodigo.get(a.question.codigoTema) && (
                        <ManualButton section={manualByCodigo.get(a.question.codigoTema)!} />
                      )}
                    </div>

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
