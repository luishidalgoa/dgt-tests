import Link from "next/link"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import {
  ChevronLeft,
  Trophy,
  Lightbulb,
  XCircle,
  History as HistoryIcon,
} from "lucide-react"

export const dynamic = "force-dynamic"

const PASS_THRESHOLD = 0.9

const CAT_COLORS: Record<string, string> = {
  "permiso-b":    "linear-gradient(135deg, #0ea5e9, #0284c7)",
  "repaso-final": "linear-gradient(135deg, #f97316, #ea580c)",
  "adas":         "linear-gradient(135deg, #a855f7, #7c3aed)",
}

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)   return "hace unos segundos"
  if (m < 60)  return `hace ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24)  return `hace ${h} h`
  const d = Math.floor(h / 24)
  if (d === 1) return "ayer"
  if (d < 7)   return `hace ${d} días`
  return date.toLocaleDateString("es-ES")
}

export default async function HistorialPage() {
  const user = await requireUser()

  const attempts = await db.examAttempt.findMany({
    where:   { userId: user.id, finishedAt: { not: null } },
    orderBy: { startedAt: "desc" },
    take:    50,
    include: {
      test: { include: { category: true } },
    },
  })

  const [totalAttempts, byCategory] = await Promise.all([
    db.examAttempt.count({ where: { userId: user.id, finishedAt: { not: null } } }),
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
      WHERE ea.userId = ${user.id} AND ea.finishedAt IS NOT NULL AND t.categoryId IS NOT NULL
      GROUP BY c.id
      ORDER BY c.id
    `,
  ])

  return (
    <div>
      <Link href="/" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Inicio
      </Link>

      <header className="page-header">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <HistoryIcon className="h-7 w-7" />
            Historial
          </h1>
          <p className="lead">
            {totalAttempts} {totalAttempts === 1 ? "intento completado" : "intentos completados"}
          </p>
        </div>
      </header>

      {/* Stats por categoría */}
      {byCategory.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3 mb-6">
          {byCategory.map((c) => {
            const sumScore = Number(c.sumScore)
            const sumTotal = Number(c.sumTotal)
            const pct = sumTotal > 0 ? Math.round((sumScore / sumTotal) * 100) : 0
            const grad = CAT_COLORS[c.categorySlug] ?? "linear-gradient(135deg, #94a3b8, #64748b)"
            return (
              <div key={c.categoryId} className="card-soft" style={{ padding: 18 }}>
                <div
                  style={{
                    display: "inline-block",
                    width: 32,
                    height: 4,
                    borderRadius: 2,
                    background: grad,
                    marginBottom: 10,
                  }}
                />
                <div style={{ fontSize: 12, color: "var(--slate-500)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {c.categoryName}
                </div>
                <div className="font-mono-tabular" style={{ fontSize: 32, fontWeight: 900, marginTop: 4, letterSpacing: "-0.03em" }}>
                  {pct}%
                </div>
                <div style={{ fontSize: 13, color: "var(--slate-500)", fontWeight: 500 }}>
                  {Number(c.total)} intentos · {sumScore}/{sumTotal} aciertos
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Listado */}
      {attempts.length === 0 ? (
        <div className="empty-state">
          <span className="ico">📊</span>
          Aún no has completado ningún test.<br />
          <Link href="/" className="btn-primary" style={{ marginTop: 18, display: "inline-flex" }}>
            Empezar un test →
          </Link>
        </div>
      ) : (
        <div className="card-soft" style={{ padding: 8 }}>
          {attempts.map((a) => {
            const score    = a.score ?? 0
            const ratio    = score / a.total
            const passed   = ratio >= PASS_THRESHOLD
            const isErrors = a.mode === "errores"
            const href = isErrors
              ? `/historial/${a.id}`
              : `/${a.test?.category.slug}/${a.test?.testNumber}/resultado/${a.id}`
            const light = passed ? "green" : ratio >= 0.7 ? "amber" : "red"

            return (
              <Link key={a.id} href={href} className="dash-row-item">
                <span className={`dash-light ${light}`} aria-hidden="true" />
                <div className="dash-row-title">
                  {isErrors ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Lightbulb className="h-4 w-4" style={{ color: "var(--amber)" }} />
                      Test de errores
                    </span>
                  ) : passed ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Trophy className="h-4 w-4" style={{ color: "var(--green)" }} />
                      {a.test?.category.name ?? ""} · Test {a.test?.testNumber ?? ""}
                    </span>
                  ) : (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <XCircle className="h-4 w-4" style={{ color: "var(--amber)" }} />
                      {a.test?.category.name ?? ""} · Test {a.test?.testNumber ?? ""}
                    </span>
                  )}
                  <small>
                    {a.mode === "examen" ? "Examen real" : a.mode === "errores" ? "Repaso de errores" : "Práctica"}
                    {" · "}
                    {timeAgo(a.startedAt)}
                  </small>
                </div>
                <div className="dash-score">{score}/{a.total}</div>
                <div className="dash-ts">{Math.round(ratio * 100)}%</div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
