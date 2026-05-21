import Link from "next/link"
import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { ChevronLeft, CheckCircle2 } from "lucide-react"

interface PageProps {
  params: Promise<{ categoria: string }>
}

export default async function CategoryPage({ params }: PageProps) {
  const user = await requireUser()
  const { categoria } = await params

  const category = await db.category.findUnique({
    where: { slug: categoria },
    include: {
      tests: {
        orderBy: { testNumber: "asc" },
        include: {
          _count: { select: { testQuestions: true } },
          attempts: {
            where: { userId: user.id, finishedAt: { not: null } },
            orderBy: { startedAt: "desc" },
            take: 1,
            select: { score: true, total: true },
          },
        },
      },
    },
  })

  if (!category) notFound()

  const passThreshold = 0.9

  return (
    <div>
      <Link href="/" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Inicio
      </Link>

      <header className="page-header">
        <div>
          <h1>{category.name}</h1>
          {category.description && <p className="lead">{category.description}</p>}
        </div>
        <span className="badge">[{category.code}]</span>
      </header>

      <div className="tile-grid">
        {category.tests.map((t) => {
          const lastAttempt = t.attempts[0]
          const score  = lastAttempt?.score ?? null
          const total  = lastAttempt?.total ?? t._count.testQuestions
          const passed = score !== null && score >= Math.ceil(total * passThreshold)
          const failed = score !== null && !passed

          return (
            <Link
              key={t.id}
              href={`/${category.slug}/${t.testNumber}`}
              className={`tile ${passed ? "passed" : failed ? "failed" : ""}`}
            >
              <div className="tile-label">Test</div>
              <div className="tile-num">{t.testNumber}</div>
              {lastAttempt ? (
                <div className="tile-score">
                  {passed && <CheckCircle2 className="h-3.5 w-3.5" />}
                  {score}/{total}
                </div>
              ) : (
                <div className="tile-pending">Sin hacer</div>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
