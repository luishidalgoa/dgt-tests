import Link from "next/link"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { getTemaName, extractTemaPrefix, compareTemaCodes } from "@/lib/temas"
import {
  ChevronLeft,
  ChartBar,
  TrendingUp,
  TrendingDown,
  Target,
} from "lucide-react"

export const dynamic = "force-dynamic"

interface TemaStatsRow {
  prefix:         string
  totalQuestions: number
  totalAnswers:   number
  correctAnswers: number
}

export default async function StatsPage() {
  const user = await requireUser()

  // Recuperamos conteos por codigoTema CRUDO. El parser de prefijo se hace
  // en JS — el `SUBSTR/INSTR` anterior tenía un bug con códigos que llevaban
  // un guion dentro del paréntesis (p.ej. "TC 2.8 (2-8.1)" salía como
  // "TC 2.8 (2"). Ver src/lib/temas.ts y temas.test.ts para el fix.
  const raw = await db.$queryRaw<
    {
      codigoTema:     string
      totalQuestions: bigint
      totalAnswers:   bigint
      correctAnswers: bigint
    }[]
  >`
    SELECT
      q.codigoTema                                 AS codigoTema,
      COUNT(DISTINCT q.id)                         AS totalQuestions,
      COUNT(a.id)                                  AS totalAnswers,
      COALESCE(SUM(CASE WHEN a.isCorrect = 1 THEN 1 ELSE 0 END), 0) AS correctAnswers
    FROM questions q
    LEFT JOIN answers a ON a.questionId = q.id
    LEFT JOIN exam_attempts ea ON ea.id = a.attemptId AND ea.userId = ${user.id}
    WHERE q.codigoTema IS NOT NULL
      AND (a.id IS NULL OR ea.id IS NOT NULL)
    GROUP BY q.codigoTema
  `

  const byPrefix = new Map<string, TemaStatsRow>()
  for (const r of raw) {
    const prefix = extractTemaPrefix(r.codigoTema)
    if (!prefix) continue // descarta basura ("TC" sin más, 4 preguntas)
    const card = byPrefix.get(prefix) ?? {
      prefix,
      totalQuestions: 0,
      totalAnswers:   0,
      correctAnswers: 0,
    }
    card.totalQuestions += Number(r.totalQuestions)
    card.totalAnswers   += Number(r.totalAnswers)
    card.correctAnswers += Number(r.correctAnswers)
    byPrefix.set(prefix, card)
  }
  const temas: TemaStatsRow[] = [...byPrefix.values()].sort((a, b) =>
    compareTemaCodes(a.prefix, b.prefix)
  )

  const [totalAttempts, totalAnswers, correctAnswers] = await Promise.all([
    db.examAttempt.count({ where: { userId: user.id, finishedAt: { not: null } } }),
    db.answer.count({ where: { attempt: { userId: user.id } } }),
    db.answer.count({ where: { isCorrect: true, attempt: { userId: user.id } } }),
  ])

  const globalAccuracy = totalAnswers > 0 ? (correctAnswers / totalAnswers) * 100 : 0

  const practiced = temas.filter((t) => t.totalAnswers > 0)
  const notPracticed = temas.filter((t) => t.totalAnswers === 0)

  practiced.sort((a, b) => {
    const accA = a.correctAnswers / a.totalAnswers
    const accB = b.correctAnswers / b.totalAnswers
    return accA - accB
  })

  return (
    <div>
      <Link href="/" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Inicio
      </Link>

      <header className="page-header">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <ChartBar className="h-7 w-7" />
            Estadísticas
          </h1>
          <p className="lead">Tu rendimiento global y por tema del temario.</p>
        </div>
      </header>

      {/* Stats globales — 4 cards */}
      <div className="grid gap-3 sm:grid-cols-4 mb-6">
        <StatCard label="Acierto global" value={`${globalAccuracy.toFixed(1)}%`} accent="green" />
        <StatCard label="Intentos"       value={String(totalAttempts)} accent="ink" />
        <StatCard label="Aciertos"        value={String(correctAnswers)} accent="green" />
        <StatCard label="Fallos"          value={String(totalAnswers - correctAnswers)} accent="red" />
      </div>

      {/* Temas practicados */}
      {practiced.length > 0 && (
        <section className="mb-8">
          <div className="dash-section-title" style={{ margin: "0 4px 14px" }}>
            <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Target className="h-5 w-5" />
              Rendimiento por tema
            </h3>
            <span style={{ color: "var(--slate-500)", fontWeight: 600, fontSize: 13 }}>
              {practiced.length} {practiced.length === 1 ? "tema" : "temas"}
            </span>
          </div>

          <div className="card-soft" style={{ padding: 8 }}>
            {practiced.map((t) => {
              const acc = (t.correctAnswers / t.totalAnswers) * 100
              const isWeak   = acc < 70
              const isStrong = acc >= 90
              const color    = isWeak ? "var(--red-500)" : isStrong ? "var(--green)" : "var(--amber)"
              const barColor = isWeak
                ? "linear-gradient(90deg, #fca5a5, var(--red-500))"
                : isStrong
                ? "linear-gradient(90deg, #86efac, var(--green-d))"
                : "linear-gradient(90deg, #fcd34d, var(--amber))"

              return (
                <div
                  key={t.prefix}
                  className="dash-row-item"
                  style={{ gridTemplateColumns: "auto 1fr auto auto", padding: "16px 18px" }}
                >
                  <span className="badge" style={{ fontSize: 11.5, padding: "4px 10px" }}>
                    {t.prefix}
                  </span>
                  <div className="dash-row-title">
                    {getTemaName(t.prefix)}
                    <small>
                      {t.totalQuestions} preguntas · {t.totalAnswers} respuestas
                    </small>
                  </div>
                  <div className="hidden sm:flex items-center" style={{ width: 140 }}>
                    <div style={{
                      flex: 1,
                      height: 8,
                      borderRadius: 999,
                      background: "var(--slate-100)",
                      overflow: "hidden",
                    }}>
                      <div style={{ width: `${acc}%`, height: "100%", background: barColor }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="font-mono-tabular" style={{ fontSize: 20, fontWeight: 800, color, minWidth: 56, textAlign: "right" }}>
                      {acc.toFixed(0)}%
                    </div>
                    {isWeak ? (
                      <TrendingDown className="h-5 w-5" style={{ color: "var(--red-500)" }} />
                    ) : isStrong ? (
                      <TrendingUp className="h-5 w-5" style={{ color: "var(--green)" }} />
                    ) : (
                      <TrendingUp className="h-5 w-5" style={{ color: "var(--amber)" }} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Temas sin practicar */}
      {notPracticed.length > 0 && (
        <section>
          <div className="dash-section-title" style={{ margin: "0 4px 14px" }}>
            <h3 style={{ color: "var(--slate-500)" }}>
              Temas sin practicar ({notPracticed.length})
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {notPracticed.map((t) => (
              <Link
                key={t.prefix}
                href={`/temas/${encodeURIComponent(t.prefix)}`}
                className="pill-ghost"
                style={{ padding: "8px 14px", fontSize: 13, fontWeight: 600 }}
              >
                <span className="font-mono-tabular" style={{ marginRight: 8, color: "var(--orange-600)" }}>
                  {t.prefix}
                </span>
                {getTemaName(t.prefix)}
                <span style={{ marginLeft: 8, color: "var(--slate-400)" }}>
                  ({t.totalQuestions})
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}


function StatCard({ label, value, accent }: { label: string; value: string; accent: "green" | "red" | "ink" }) {
  const color =
    accent === "green" ? "var(--green)" :
    accent === "red"   ? "var(--red-500)" :
    "var(--ink)"
  return (
    <div className="card-soft" style={{ padding: 16 }}>
      <div style={{ fontSize: 11.5, color: "var(--slate-500)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div className="font-mono-tabular" style={{ fontSize: 28, fontWeight: 900, marginTop: 6, color, letterSpacing: "-0.02em" }}>
        {value}
      </div>
    </div>
  )
}
