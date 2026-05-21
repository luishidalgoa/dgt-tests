import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { getTemaName } from "@/lib/temas"
import { ExamRunner } from "@/components/ExamRunner"
import { Badge } from "@/components/ui/badge"
import { ChevronLeft, BookMarked, Sparkles } from "lucide-react"
import type { TestRunnerData } from "@/types/exam"

export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ prefix: string }>
  searchParams: Promise<{ n?: string }>
}

export default async function TemaPage({ params, searchParams }: PageProps) {
  const user = await getCurrentUser()
  if (!user) redirect("/")
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
    // Calcular stats del tema del usuario (solo si está logueado)
    const answered = user
      ? await db.answer.count({
          where: {
            questionId: { in: allQuestionIds.map((q) => q.id) },
            attempt:    { userId: user.id },
          },
        })
      : 0
    const correct = user
      ? await db.answer.count({
          where: {
            questionId: { in: allQuestionIds.map((q) => q.id) },
            isCorrect: true,
            attempt:    { userId: user.id },
          },
        })
      : 0
    const acc = answered > 0 ? (correct / answered) * 100 : null

    const options = [10, 20, 30, totalAvailable].filter(
      (n, i, arr) => n <= totalAvailable && arr.indexOf(n) === i
    )

    return (
      <div>
        <Link href="/temas" className="back-link">
          <ChevronLeft className="h-4 w-4" />
          Todos los temas
        </Link>

        <header className="page-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <BookMarked className="h-6 w-6" style={{ color: "var(--orange-600)" }} />
              <span className="badge">{prefix}</span>
            </div>
            <h1>{getTemaName(prefix)}</h1>
          </div>
        </header>

        <div className="card-soft warm" style={{ padding: 28, marginBottom: 6 }}>
          <div className="flex items-center justify-between gap-6 flex-wrap mb-6">
            <div>
              <div style={{ fontSize: 11.5, color: "var(--slate-500)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Preguntas en este tema
              </div>
              <div className="font-mono-tabular" style={{ fontSize: 44, fontWeight: 900, marginTop: 4, letterSpacing: "-0.03em" }}>
                {totalAvailable}
              </div>
            </div>
            {acc !== null && (
              <div className="text-right">
                <div style={{ fontSize: 11.5, color: "var(--slate-500)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Tu acierto
                </div>
                <div
                  className="font-mono-tabular"
                  style={{
                    fontSize: 44,
                    fontWeight: 900,
                    marginTop: 4,
                    letterSpacing: "-0.03em",
                    color: acc < 70 ? "var(--red-500)" : acc >= 90 ? "var(--green)" : "var(--amber)",
                  }}
                >
                  {acc.toFixed(0)}%
                </div>
                <div style={{ fontSize: 12, color: "var(--slate-500)" }}>
                  {correct}/{answered} respuestas
                </div>
              </div>
            )}
            <Sparkles className="h-10 w-10 hidden lg:block" style={{ color: "var(--amber)" }} />
          </div>

          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10, color: "var(--slate-700)" }}>
              ¿Cuántas preguntas quieres practicar?
            </div>
            <div className="flex flex-wrap gap-2">
              {options.map((n) => (
                <Link
                  key={n}
                  href={`/temas/${rawPrefix}?n=${n}`}
                  className={n === totalAvailable ? "btn-primary" : "btn-secondary"}
                >
                  {n === totalAvailable ? `Todas (${n})` : n}
                </Link>
              ))}
            </div>
          </div>

          <p style={{ fontSize: 12, color: "var(--slate-500)", marginTop: 18, marginBottom: 0 }}>
            Las preguntas se seleccionan en orden aleatorio entre las {totalAvailable} disponibles.
          </p>
        </div>
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
      // Práctica por tema: siempre enviamos solución para feedback inline
      correctOptionId: q.options.find((o) => o.isCorrect)?.id ?? null,
      explicacion:     q.explicacion ?? null,
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
      <ExamRunner
        data={data}
        mode="errores"
        aiQuota={Number(process.env.AI_QUESTIONS_PER_EXAM ?? 5)}
      />
    </div>
  )
}
