import Link from "next/link"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { getTemaName } from "@/lib/temas"

export const dynamic = "force-dynamic"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  ChevronLeft,
  ChartBar,
  TrendingUp,
  TrendingDown,
  Target,
} from "lucide-react"

interface TemaStatsRow {
  prefix:           string
  totalQuestions:   number
  totalAnswers:     number
  correctAnswers:   number
}

export default async function StatsPage() {
  const user = await requireUser()

  // Stats por prefijo de tema (TC X.Y) — scoped al usuario
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
    LEFT JOIN exam_attempts ea ON ea.id = a.attemptId AND ea.userId = ${user.id}
    WHERE q.codigoTema IS NOT NULL
      AND (a.id IS NULL OR ea.id IS NOT NULL)
    GROUP BY prefix
    ORDER BY prefix
  `

  const temas: TemaStatsRow[] = raw.map((r) => ({
    prefix:         r.prefix.trim(),
    totalQuestions: Number(r.totalQuestions),
    totalAnswers:   Number(r.totalAnswers),
    correctAnswers: Number(r.correctAnswers),
  }))

  // Stats globales del usuario
  const [totalAttempts, totalAnswers, correctAnswers] = await Promise.all([
    db.examAttempt.count({ where: { userId: user.id, finishedAt: { not: null } } }),
    db.answer.count({ where: { attempt: { userId: user.id } } }),
    db.answer.count({ where: { isCorrect: true, attempt: { userId: user.id } } }),
  ])

  const globalAccuracy = totalAnswers > 0 ? (correctAnswers / totalAnswers) * 100 : 0

  // Separar temas practicados vs no practicados
  const practiced = temas.filter((t) => t.totalAnswers > 0)
  const notPracticed = temas.filter((t) => t.totalAnswers === 0)

  // Ordenar practicados por % acierto ASC (peores primero)
  practiced.sort((a, b) => {
    const accA = a.correctAnswers / a.totalAnswers
    const accB = b.correctAnswers / b.totalAnswers
    return accA - accB
  })

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1">
        <ChevronLeft className="h-4 w-4" />
        Inicio
      </Link>

      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <ChartBar className="h-7 w-7" />
          Estadísticas
        </h1>
        <p className="text-slate-600 mt-1">
          Tu rendimiento global y por tema del temario.
        </p>
      </div>

      {/* Stats globales */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">Acierto global</div>
            <div className="text-3xl font-bold mt-1">{globalAccuracy.toFixed(1)}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">Intentos</div>
            <div className="text-3xl font-bold mt-1">{totalAttempts}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">Aciertos</div>
            <div className="text-3xl font-bold mt-1 text-emerald-600">{correctAnswers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">Fallos</div>
            <div className="text-3xl font-bold mt-1 text-red-500">{totalAnswers - correctAnswers}</div>
          </CardContent>
        </Card>
      </div>

      {/* Temas practicados ordenados por acierto ASC */}
      {practiced.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold flex items-center gap-2 mb-3">
            <Target className="h-5 w-5" />
            Rendimiento por tema
          </h2>
          <div className="space-y-2">
            {practiced.map((t) => {
              const acc = (t.correctAnswers / t.totalAnswers) * 100
              const isWeak = acc < 70
              const isStrong = acc >= 90
              return (
                <Card
                  key={t.prefix}
                  className={
                    isWeak ? "border-red-200" : isStrong ? "border-emerald-200" : ""
                  }
                >
                  <CardContent className="p-4 flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="font-mono text-xs">
                          {t.prefix}
                        </Badge>
                        <span className="font-medium truncate">{getTemaName(t.prefix)}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {t.totalQuestions} preguntas en el banco · {t.totalAnswers} respuestas dadas
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="hidden sm:block w-32 bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full ${
                            isWeak ? "bg-red-400" : isStrong ? "bg-emerald-400" : "bg-amber-400"
                          }`}
                          style={{ width: `${acc}%` }}
                        />
                      </div>
                      <div className="text-right min-w-[80px]">
                        <div
                          className={`text-xl font-bold ${
                            isWeak ? "text-red-600" : isStrong ? "text-emerald-600" : ""
                          }`}
                        >
                          {acc.toFixed(0)}%
                        </div>
                        <div className="text-xs text-slate-500 font-mono">
                          {t.correctAnswers}/{t.totalAnswers}
                        </div>
                      </div>
                      {isWeak ? (
                        <TrendingDown className="h-5 w-5 text-red-500" />
                      ) : isStrong ? (
                        <TrendingUp className="h-5 w-5 text-emerald-500" />
                      ) : (
                        <TrendingUp className="h-5 w-5 text-amber-400" />
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </section>
      )}

      {/* Temas sin practicar */}
      {notPracticed.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold mb-3 text-slate-600">
            Temas sin practicar ({notPracticed.length})
          </h2>
          <div className="flex flex-wrap gap-2">
            {notPracticed.map((t) => (
              <Badge key={t.prefix} variant="outline" className="px-3 py-1">
                <span className="font-mono mr-2">{t.prefix}</span>
                {getTemaName(t.prefix)}
                <span className="ml-2 text-slate-500">({t.totalQuestions})</span>
              </Badge>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
