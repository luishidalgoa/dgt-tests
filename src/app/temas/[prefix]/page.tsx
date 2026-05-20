import Link from "next/link"
import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { getTemaName } from "@/lib/temas"
import { ExamRunner } from "@/components/ExamRunner"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ChevronLeft, BookMarked, Sparkles } from "lucide-react"
import type { TestRunnerData } from "@/types/exam"

interface PageProps {
  params: Promise<{ prefix: string }>
  searchParams: Promise<{ n?: string }>
}

export default async function TemaPage({ params, searchParams }: PageProps) {
  const { prefix: rawPrefix } = await params
  const sp = await searchParams
  const prefix = decodeURIComponent(rawPrefix)
  const requested = sp.n ? Math.max(1, Math.min(parseInt(sp.n, 10), 200)) : null

  // Encontrar todas las preguntas del tema
  const allQuestionIds = await db.$queryRaw<{ id: number }[]>`
    SELECT id FROM questions
    WHERE codigoTema LIKE ${prefix + "-%"} OR codigoTema = ${prefix}
  `
  const totalAvailable = allQuestionIds.length

  if (totalAvailable === 0) notFound()

  // Vista de selección
  if (!requested) {
    // Calcular stats del tema
    const answered = await db.answer.count({
      where: { questionId: { in: allQuestionIds.map((q) => q.id) } },
    })
    const correct = await db.answer.count({
      where: {
        questionId: { in: allQuestionIds.map((q) => q.id) },
        isCorrect: true,
      },
    })
    const acc = answered > 0 ? (correct / answered) * 100 : null

    const options = [10, 20, 30, totalAvailable].filter(
      (n, i, arr) => n <= totalAvailable && arr.indexOf(n) === i
    )

    return (
      <div className="space-y-6">
        <Link href="/temas" className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1">
          <ChevronLeft className="h-4 w-4" />
          Todos los temas
        </Link>

        <div>
          <div className="flex items-center gap-2 mb-1">
            <BookMarked className="h-7 w-7" />
            <Badge variant="secondary" className="font-mono">
              {prefix}
            </Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{getTemaName(prefix)}</h1>
        </div>

        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between gap-6 flex-wrap">
              <div>
                <div className="text-sm text-slate-500">Preguntas en este tema</div>
                <div className="text-4xl font-bold mt-1">{totalAvailable}</div>
              </div>
              {acc !== null && (
                <div className="text-right">
                  <div className="text-sm text-slate-500">Tu acierto en este tema</div>
                  <div className={`text-4xl font-bold mt-1 ${acc < 70 ? "text-red-500" : "text-emerald-600"}`}>
                    {acc.toFixed(0)}%
                  </div>
                  <div className="text-xs text-slate-500">{correct}/{answered} respuestas</div>
                </div>
              )}
              <Sparkles className="h-10 w-10 text-amber-400 hidden lg:block" />
            </div>

            <div>
              <div className="text-sm font-medium mb-2">¿Cuántas preguntas quieres practicar?</div>
              <div className="flex flex-wrap gap-2">
                {options.map((n) => (
                  <Button key={n} variant="outline" asChild>
                    <Link href={`/temas/${rawPrefix}?n=${n}`}>
                      {n === totalAvailable ? `Todas (${n})` : n}
                    </Link>
                  </Button>
                ))}
              </div>
            </div>

            <p className="text-xs text-slate-500">
              Las preguntas se seleccionan en orden aleatorio entre las {totalAvailable} disponibles.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Generar test aleatorio del tema
  const shuffled = [...allQuestionIds].sort(() => Math.random() - 0.5)
  const selectedIds = shuffled.slice(0, requested).map((q) => q.id)

  const questions = await db.question.findMany({
    where: { id: { in: selectedIds } },
    include: { options: { orderBy: { letra: "asc" } } },
  })

  const orderMap = new Map(selectedIds.map((id, i) => [id, i]))
  questions.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0))

  const data: TestRunnerData = {
    test: {
      id:             0,
      testNumber:     0,
      totalQuestions: questions.length,
      category: {
        slug: `tema-${prefix.replace(/\s+/g, "-").toLowerCase()}`,
        name: getTemaName(prefix),
        code: prefix,
      },
    },
    questions: questions.map((q) => ({
      id:         q.id,
      externalId: q.externalId,
      enunciado:  q.enunciado,
      imagen:     q.imagen,
      codigoTema: q.codigoTema,
      options:    q.options.map((o) => ({ id: o.id, letra: o.letra, texto: o.texto })),
    })),
  }

  return (
    <div className="space-y-4">
      <Link href={`/temas/${rawPrefix}`} className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1">
        <ChevronLeft className="h-4 w-4" />
        Volver al tema
      </Link>
      <div className="flex items-center gap-2 text-sm text-slate-700">
        <BookMarked className="h-4 w-4" />
        <span>Practicando {questions.length} preguntas del tema</span>
        <Badge variant="secondary" className="font-mono">{prefix}</Badge>
        <span className="text-slate-500">— {getTemaName(prefix)}</span>
      </div>
      <ExamRunner data={data} mode="errores" />
    </div>
  )
}
