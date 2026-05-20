import Link from "next/link"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ArrowRight, BookOpen, History, AlertTriangle } from "lucide-react"

export default async function HomePage() {
  const categories = await db.category.findMany({
    include: {
      _count: { select: { tests: true } },
    },
    orderBy: { id: "asc" },
  })

  // Stats globales rápidos
  const [totalAttempts, totalAnswers, recentAttempts] = await Promise.all([
    db.examAttempt.count({ where: { finishedAt: { not: null } } }),
    db.answer.count(),
    db.examAttempt.findMany({
      where: { finishedAt: { not: null } },
      orderBy: { startedAt: "desc" },
      take: 3,
      include: { test: { include: { category: true } } },
    }),
  ])

  // Errores pendientes (preguntas con última respuesta incorrecta)
  const pendingErrors = await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM (
      SELECT a.questionId, MAX(a.id) as lastId
      FROM answers a
      GROUP BY a.questionId
    ) last
    JOIN answers a ON a.id = last.lastId
    WHERE a.isCorrect = 0
  `
  const errorsCount = Number(pendingErrors[0]?.count ?? 0)

  return (
    <div className="space-y-10">
      {/* Hero */}
      <section>
        <h1 className="text-3xl font-bold tracking-tight">¡Practica tus tests de la DGT!</h1>
        <p className="text-slate-600 mt-2">
          Elige una categoría, haz un test cuando quieras y revisa los errores recientes.
        </p>
      </section>

      {/* Categorías */}
      <section>
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          Categorías
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => (
            <Link key={c.id} href={`/${c.slug}`} className="group">
              <Card className="h-full transition hover:shadow-md hover:border-slate-300">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>{c.name}</CardTitle>
                    <Badge variant="secondary">{c.code}</Badge>
                  </div>
                  <CardDescription>{c.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-sm text-slate-600">
                    <span>
                      {c._count.tests} {c._count.tests === 1 ? "test" : "tests"} disponibles
                    </span>
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* Stats + accesos rápidos */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/test-errores" className="block">
          <Card className={`h-full transition hover:shadow-md ${errorsCount > 0 ? "border-amber-200" : ""}`}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Test de errores
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{errorsCount}</div>
              <p className="text-sm text-slate-600 mt-1">
                {errorsCount === 0 ? "Sin errores pendientes." : "preguntas falladas sin corregir"}
              </p>
            </CardContent>
          </Card>
        </Link>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Intentos completados</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalAttempts}</div>
            <p className="text-sm text-slate-600 mt-1">{totalAnswers} respuestas registradas</p>
          </CardContent>
        </Card>

        <Link href="/historial" className="block">
          <Card className="h-full transition hover:shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4" />
                Historial reciente
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentAttempts.length === 0 ? (
                <p className="text-sm text-slate-500">Aún no has hecho ningún test.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {recentAttempts.map((a) => (
                    <li key={a.id} className="flex items-center justify-between">
                      <span className="truncate">
                        {a.test?.category?.name ?? "Errores"} – T{a.test?.testNumber ?? ""}
                      </span>
                      <span className="font-mono text-slate-600">
                        {a.score}/{a.total}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </Link>
      </section>
    </div>
  )
}
