import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { ChevronLeft, CheckCircle2, Lock } from "lucide-react"

export const dynamic = "force-dynamic"

const GUEST_CATEGORY_SLUG = "permiso-b"
const GUEST_TEST_LIMIT = 7

interface PageProps {
  params: Promise<{ categoria: string }>
}

export default async function CategoryPage({ params }: PageProps) {
  const user = await getCurrentUser()
  const { categoria } = await params

  // Invitados: solo permiso-b. Otras categorías → al dashboard guest.
  if (!user && categoria !== GUEST_CATEGORY_SLUG) {
    redirect("/")
  }

  const category = await db.category.findUnique({
    where: { slug: categoria },
    include: {
      tests: {
        orderBy: { testNumber: "asc" },
        include: {
          _count: { select: { testQuestions: true } },
          attempts: user
            ? {
                where: { userId: user.id, finishedAt: { not: null } },
                orderBy: { startedAt: "desc" },
                take: 1,
                select: { score: true, total: true },
              }
            : {
                where: { id: -1 }, // empty: no attempts for guests
                take: 0,
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

      {!user && (
        <div
          className="card-soft"
          style={{
            padding: "12px 16px",
            marginBottom: 16,
            fontSize: 13.5,
            color: "var(--slate-600)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span>
            Como <b>invitado</b> tienes acceso a los <b>{GUEST_TEST_LIMIT} primeros tests</b>. Tu progreso no se guarda.
          </span>
          <Link href="/register" className="btn-secondary" style={{ fontSize: 13 }}>
            Crear cuenta
          </Link>
        </div>
      )}

      <div className="tile-grid">
        {category.tests.map((t) => {
          const lastAttempt = t.attempts[0]
          const score  = lastAttempt?.score ?? null
          const total  = lastAttempt?.total ?? t._count.testQuestions
          const passed = score !== null && score >= Math.ceil(total * passThreshold)
          const failed = score !== null && !passed
          const lockedForGuest = !user && t.testNumber > GUEST_TEST_LIMIT

          if (lockedForGuest) {
            return (
              <Link
                key={t.id}
                href="/register"
                className="tile"
                style={{
                  opacity: 0.55,
                  borderStyle: "dashed",
                  background: "rgba(148, 163, 184, 0.06)",
                }}
                title="Crea una cuenta para desbloquear"
              >
                <div className="tile-label" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Lock className="h-3 w-3" />
                  Test
                </div>
                <div className="tile-num">{t.testNumber}</div>
                <div className="tile-pending">Crea cuenta</div>
              </Link>
            )
          }

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
                <div className="tile-pending">{user ? "Sin hacer" : `${t._count.testQuestions} preguntas`}</div>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
