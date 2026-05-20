import Link from "next/link"
import { db } from "@/lib/db"
import { getTemaName } from "@/lib/temas"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ChevronLeft, BookMarked, ArrowRight } from "lucide-react"

export default async function TemasPage() {
  // Stats por prefijo de tema + nº de respuestas y aciertos
  const raw = await db.$queryRaw<
    { prefix: string; totalQuestions: bigint; totalAnswers: bigint; correctAnswers: bigint }[]
  >`
    SELECT
      CASE
        WHEN INSTR(q.codigoTema, '-') > 0
        THEN SUBSTR(q.codigoTema, 1, INSTR(q.codigoTema, '-') - 1)
        ELSE q.codigoTema
      END                                          AS prefix,
      COUNT(DISTINCT q.id)                         AS totalQuestions,
      COUNT(a.id)                                  AS totalAnswers,
      COALESCE(SUM(CASE WHEN a.isCorrect = 1 THEN 1 ELSE 0 END), 0) AS correctAnswers
    FROM questions q
    LEFT JOIN answers a ON a.questionId = q.id
    WHERE q.codigoTema IS NOT NULL
    GROUP BY prefix
    ORDER BY prefix
  `

  const temas = raw.map((r) => ({
    prefix:         r.prefix.trim(),
    totalQuestions: Number(r.totalQuestions),
    totalAnswers:   Number(r.totalAnswers),
    correctAnswers: Number(r.correctAnswers),
  }))

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1">
        <ChevronLeft className="h-4 w-4" />
        Inicio
      </Link>

      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <BookMarked className="h-7 w-7" />
          Tests por tema
        </h1>
        <p className="text-slate-600 mt-1">
          Practica preguntas de un tema concreto del temario.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {temas.map((t) => {
          const acc = t.totalAnswers > 0 ? (t.correctAnswers / t.totalAnswers) * 100 : null
          return (
            <Link key={t.prefix} href={`/temas/${encodeURIComponent(t.prefix)}`}>
              <Card className="h-full hover:shadow-md hover:border-slate-300 transition cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="secondary" className="font-mono text-xs">
                          {t.prefix}
                        </Badge>
                      </div>
                      <h3 className="font-medium text-base leading-snug">{getTemaName(t.prefix)}</h3>
                      <div className="text-xs text-slate-500 mt-2">
                        {t.totalQuestions} preguntas
                        {t.totalAnswers > 0 && (
                          <>
                            {" · "}
                            <span className={acc !== null && acc < 70 ? "text-red-500" : "text-emerald-600"}>
                              {acc?.toFixed(0)}% acierto
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-400 flex-shrink-0 mt-1" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
