import Link from "next/link"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ChevronLeft,
  CheckCircle2,
  XCircle,
  Trophy,
  Lightbulb,
  History as HistoryIcon,
  ArrowRight,
} from "lucide-react"

const PASS_THRESHOLD = 0.9

export default async function HistorialPage() {
  const attempts = await db.examAttempt.findMany({
    where: { finishedAt: { not: null } },
    orderBy: { startedAt: "desc" },
    take: 50,
    include: {
      test: { include: { category: true } },
    },
  })

  // Stats agregadas
  const [totalAttempts, byCategory] = await Promise.all([
    db.examAttempt.count({ where: { finishedAt: { not: null } } }),
    db.$queryRaw<
      { categoryId: number; categoryName: string; categorySlug: string; total: number; sumScore: number; sumTotal: number }[]
    >`
      SELECT
        c.id        as categoryId,
        c.name      as categoryName,
        c.slug      as categorySlug,
        COUNT(*)    as total,
        SUM(ea.score) as sumScore,
        SUM(ea.total) as sumTotal
      FROM exam_attempts ea
      LEFT JOIN tests t ON ea.testId = t.id
      LEFT JOIN categories c ON t.categoryId = c.id
      WHERE ea.finishedAt IS NOT NULL AND t.categoryId IS NOT NULL
      GROUP BY c.id
      ORDER BY c.id
    `,
  ])

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1">
        <ChevronLeft className="h-4 w-4" />
        Inicio
      </Link>

      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <HistoryIcon className="h-7 w-7" />
          Historial
        </h1>
        <p className="text-slate-600 mt-1">
          {totalAttempts} {totalAttempts === 1 ? "intento completado" : "intentos completados"}
        </p>
      </div>

      {/* Stats por categoría */}
      {byCategory.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {byCategory.map((c) => {
            const sumScore = Number(c.sumScore)
            const sumTotal = Number(c.sumTotal)
            const pct = sumTotal > 0 ? Math.round((sumScore / sumTotal) * 100) : 0
            return (
              <Card key={c.categoryId}>
                <CardContent className="p-4">
                  <div className="text-xs text-slate-500">{c.categoryName}</div>
                  <div className="text-2xl font-bold mt-1">{pct}%</div>
                  <div className="text-sm text-slate-600">
                    {Number(c.total)} intentos · {sumScore}/{sumTotal} aciertos
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Listado */}
      {attempts.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <p className="text-slate-500">Aún no has completado ningún test.</p>
            <Button asChild>
              <Link href="/">
                Ir a la página de inicio
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {attempts.map((a) => {
            const score = a.score ?? 0
            const passed = score / a.total >= PASS_THRESHOLD
            const isErrors = a.mode === "errores"
            const href = isErrors
              ? `/historial/${a.id}`
              : `/${a.test?.category.slug}/${a.test?.testNumber}/resultado/${a.id}`

            return (
              <Link key={a.id} href={href}>
                <Card className="hover:shadow-sm hover:border-slate-300 transition cursor-pointer">
                  <CardContent className="p-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {passed ? (
                        <Trophy className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                      ) : isErrors ? (
                        <Lightbulb className="h-5 w-5 text-amber-500 flex-shrink-0" />
                      ) : (
                        <XCircle className="h-5 w-5 text-amber-500 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {isErrors
                            ? "Test de errores"
                            : `${a.test?.category.name ?? ""} · Test ${a.test?.testNumber ?? ""}`}
                        </div>
                        <div className="text-xs text-slate-500">
                          {a.startedAt.toLocaleString("es-ES")}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 flex-shrink-0">
                      {isErrors && (
                        <Badge variant="outline" className="text-amber-700 border-amber-200">
                          Errores
                        </Badge>
                      )}
                      <div className="text-right">
                        <div className={`text-xl font-bold font-mono ${passed ? "text-emerald-600" : ""}`}>
                          {score}<span className="text-slate-400">/{a.total}</span>
                        </div>
                        <div className="text-xs text-slate-500">
                          {Math.round((score / a.total) * 100)}%
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-slate-400" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
