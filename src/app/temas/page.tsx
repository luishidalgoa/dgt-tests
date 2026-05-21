import Link from "next/link"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { hasFullAccess } from "@/lib/permissions"
import { getTemaName } from "@/lib/temas"
import { ChevronLeft, BookMarked, ArrowRight, BookOpen } from "lucide-react"

export const dynamic = "force-dynamic"

export default async function TemasPage() {
  const user = await getCurrentUser()

  // /temas no está disponible en modo invitado
  if (!user) redirect("/")
  // Tampoco para free — es contenido PRO
  if (!hasFullAccess(user)) redirect("/upgrade")

  // Para invitados: solo conteo de preguntas por tema (sin stats personales).
  // Para usuarios logueados: además, contar respuestas y aciertos.
  let temas: { prefix: string; totalQuestions: number; totalAnswers: number; correctAnswers: number }[]

  if (user) {
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
    temas = raw.map((r) => ({
      prefix:         r.prefix.trim(),
      totalQuestions: Number(r.totalQuestions),
      totalAnswers:   Number(r.totalAnswers),
      correctAnswers: Number(r.correctAnswers),
    }))
  } else {
    const raw = await db.$queryRaw<
      { prefix: string; totalQuestions: bigint }[]
    >`
      SELECT
        CASE
          WHEN INSTR(q.codigoTema, '-') > 0
          THEN SUBSTR(q.codigoTema, 1, INSTR(q.codigoTema, '-') - 1)
          ELSE q.codigoTema
        END                                          AS prefix,
        COUNT(DISTINCT q.id)                         AS totalQuestions
      FROM questions q
      WHERE q.codigoTema IS NOT NULL
      GROUP BY prefix
      ORDER BY prefix
    `
    temas = raw.map((r) => ({
      prefix:         r.prefix.trim(),
      totalQuestions: Number(r.totalQuestions),
      totalAnswers:   0,
      correctAnswers: 0,
    }))
  }

  return (
    <div>
      <Link href="/" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Inicio
      </Link>

      <header className="page-header">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <BookMarked className="h-7 w-7" />
            Tests por tema
          </h1>
          <p className="lead">Practica preguntas de un tema concreto del temario.</p>
        </div>
      </header>

      {/* CTA: ver libro completo */}
      <Link
        href="/temas/libro"
        className="card-soft warm"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: 22,
          marginBottom: 20,
          textDecoration: "none",
          color: "inherit",
          background:
            "linear-gradient(120deg, rgba(249, 115, 22, 0.10) 0%, #fff 65%)",
          borderColor: "rgba(249, 115, 22, 0.35)",
        }}
      >
        <div
          className="flex-shrink-0 flex items-center justify-center rounded-2xl"
          style={{
            width: 56,
            height: 56,
            background: "linear-gradient(135deg, var(--orange-500), var(--red-600))",
            color: "#fff",
            boxShadow: "0 10px 22px -10px rgba(220, 38, 38, 0.55)",
          }}
        >
          <BookOpen className="h-7 w-7" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800 }}>
            Ver libro completo
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--slate-600)" }}>
            Lee todas las secciones del manual del temario en flipbook, ordenadas por tema.
          </p>
        </div>
        <ArrowRight className="h-5 w-5" style={{ color: "var(--orange-600)", flexShrink: 0 }} />
      </Link>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {temas.map((t) => {
          const acc = t.totalAnswers > 0 ? (t.correctAnswers / t.totalAnswers) * 100 : null
          const accColor = acc === null
            ? "var(--slate-400)"
            : acc < 70
            ? "var(--red-500)"
            : acc >= 90
            ? "var(--green)"
            : "var(--amber)"
          return (
            <Link
              key={t.prefix}
              href={`/temas/${encodeURIComponent(t.prefix)}`}
              className="card-soft"
              style={{
                padding: 18,
                textDecoration: "none",
                color: "inherit",
                display: "block",
                transition: "transform 0.15s, border-color 0.15s, box-shadow 0.15s",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span
                      className="font-mono-tabular"
                      style={{
                        padding: "3px 9px",
                        borderRadius: 6,
                        background: "rgba(249, 115, 22, 0.12)",
                        color: "var(--orange-600)",
                        fontSize: 11.5,
                        fontWeight: 700,
                      }}
                    >
                      {t.prefix}
                    </span>
                    {acc !== null && (
                      <span
                        className="font-mono-tabular"
                        style={{ marginLeft: "auto", fontSize: 14, fontWeight: 800, color: accColor }}
                      >
                        {acc.toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <h3 style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.35, margin: 0 }}>
                    {getTemaName(t.prefix)}
                  </h3>
                  <div style={{ marginTop: 10, fontSize: 12, color: "var(--slate-500)", fontWeight: 500 }}>
                    {t.totalQuestions} preguntas
                    {t.totalAnswers > 0 && ` · ${t.correctAnswers}/${t.totalAnswers} aciertos`}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4" style={{ color: "var(--slate-400)", flexShrink: 0, marginTop: 2 }} />
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
