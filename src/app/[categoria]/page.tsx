import Link from "next/link"
import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ChevronLeft, CheckCircle2 } from "lucide-react"

interface PageProps {
  params: Promise<{ categoria: string }>
}

export default async function CategoryPage({ params }: PageProps) {
  const { categoria } = await params

  const category = await db.category.findUnique({
    where: { slug: categoria },
    include: {
      tests: {
        orderBy: { testNumber: "asc" },
        include: {
          _count: { select: { testQuestions: true } },
          attempts: {
            where: { finishedAt: { not: null } },
            orderBy: { startedAt: "desc" },
            take: 1,
            select: { score: true, total: true, startedAt: true },
          },
        },
      },
    },
  })

  if (!category) notFound()

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1">
          <ChevronLeft className="h-4 w-4" />
          Inicio
        </Link>
        <div className="flex items-end justify-between mt-2">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{category.name}</h1>
            {category.description && (
              <p className="text-slate-600 mt-1">{category.description}</p>
            )}
          </div>
          <Badge variant="secondary" className="text-sm">
            [{category.code}]
          </Badge>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {category.tests.map((t) => {
          const lastAttempt = t.attempts[0]
          const score = lastAttempt?.score ?? null
          const total = lastAttempt?.total ?? t._count.testQuestions
          const passed = score !== null && score >= Math.ceil(total * 0.9)
          return (
            <Link key={t.id} href={`/${category.slug}/${t.testNumber}`}>
              <Card className="hover:shadow-md hover:border-slate-300 transition cursor-pointer h-full">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-slate-500">Test</div>
                    <div className="text-2xl font-bold leading-none">{t.testNumber}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      {t._count.testQuestions} preguntas
                    </div>
                  </div>
                  <div className="text-right">
                    {lastAttempt ? (
                      <>
                        <div className={`text-lg font-semibold font-mono ${passed ? "text-emerald-600" : "text-slate-600"}`}>
                          {score}/{total}
                        </div>
                        {passed && <CheckCircle2 className="h-4 w-4 text-emerald-500 inline-block" />}
                      </>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        Sin hacer
                      </Badge>
                    )}
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
