import Link from "next/link"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { Play, Zap, AlertTriangle } from "lucide-react"

export const dynamic = "force-dynamic"

const CATEGORY_THEMES: Record<string, { className: string; icon: string }> = {
  "permiso-b":    { className: "blue",   icon: "🚗" },
  "repaso-final": { className: "orange", icon: "📖" },
  "adas":         { className: "purple", icon: "🤖" },
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 6)  return "¡Buenas noches"
  if (h < 13) return "¡Buenos días"
  if (h < 20) return "¡Buenas tardes"
  return "¡Buenas noches"
}

function trafficLight(ratio: number): "green" | "amber" | "red" {
  if (ratio >= 0.9) return "green"
  if (ratio >= 0.7) return "amber"
  return "red"
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

export default async function HomePage() {
  const user = await requireUser()

  // Categorías + nº de tests
  const categories = await db.category.findMany({
    include: { _count: { select: { tests: true } } },
    orderBy: { id: "asc" },
  })

  // Stats del usuario
  const [totalAttempts, totalAnswers, correctAnswers, recentAttempts] = await Promise.all([
    db.examAttempt.count({ where: { userId: user.id, finishedAt: { not: null } } }),
    db.answer.count({ where: { attempt: { userId: user.id } } }),
    db.answer.count({ where: { attempt: { userId: user.id }, isCorrect: true } }),
    db.examAttempt.findMany({
      where: { userId: user.id, finishedAt: { not: null } },
      orderBy: { startedAt: "desc" },
      take: 5,
      include: { test: { include: { category: true } } },
    }),
  ])

  const accuracy = totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 100) : 0

  // % de tests hechos por categoría (al menos 1 attempt finalizado)
  const doneByCategory = new Map<number, number>()
  for (const c of categories) {
    const done = await db.test.count({
      where: {
        categoryId: c.id,
        attempts: { some: { userId: user.id, finishedAt: { not: null } } },
      },
    })
    doneByCategory.set(c.id, c._count.tests > 0 ? Math.round((done / c._count.tests) * 100) : 0)
  }

  // Racha: días con al menos 1 attempt finalizado en los últimos 7 días
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const weekAttempts = await db.examAttempt.findMany({
    where: { userId: user.id, finishedAt: { not: null }, startedAt: { gte: sevenDaysAgo } },
    select: { startedAt: true },
  })
  const todayMid = new Date()
  todayMid.setHours(0, 0, 0, 0)
  const last5: { letter: string; active: boolean }[] = []
  const DAY_LETTERS = ["D", "L", "M", "X", "J", "V", "S"]
  for (let i = 4; i >= 0; i--) {
    const day = new Date(todayMid.getTime() - i * 86400000)
    const next = new Date(day.getTime() + 86400000)
    const active = weekAttempts.some(
      (a) => a.startedAt >= day && a.startedAt < next
    )
    last5.push({ letter: DAY_LETTERS[day.getDay()], active })
  }
  const streakDays = last5.reduce(
    (acc, d) => (d.active ? acc + 1 : 0),
    0
  )

  // Errores pendientes
  const pendingErrors = await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM (
      SELECT a.questionId, MAX(a.id) as lastId
      FROM answers a
      JOIN exam_attempts ea ON ea.id = a.attemptId
      WHERE ea.userId = ${user.id}
      GROUP BY a.questionId
    ) last
    JOIN answers a ON a.id = last.lastId
    WHERE a.isCorrect = 0
  `
  const errorsCount = Number(pendingErrors[0]?.count ?? 0)

  // Para "Continuar donde lo dejaste": último test no perfeccionado
  const lastTest = recentAttempts[0]?.test
  const continueHref = lastTest
    ? `/${lastTest.category.slug}/${lastTest.testNumber}`
    : `/${categories[0]?.slug ?? "permiso-b"}`

  return (
    <div className="dash-grid">
      {/* WELCOME */}
      <section className="dash-welcome">
        <div>
          <h2>
            {greeting()}, {user.displayName ?? user.username}! 👋
          </h2>
          <p>
            Ya llevas <b>{totalAttempts}</b>{" "}
            {totalAttempts === 1 ? "test hecho" : "tests hechos"}. Tu acierto medio:
          </p>
          <div className="dash-stat">
            <div className={`big ${totalAnswers === 0 ? "muted" : ""}`}>
              {totalAnswers === 0 ? "—" : `${accuracy}%`}
            </div>
            <div className="lbl">
              {totalAnswers === 0 ? (
                <>
                  <b>Empieza tu primer test</b>
                  <br />
                  Aún sin datos
                </>
              ) : accuracy >= 90 ? (
                <>
                  <b>✓ Listo para el examen</b>
                  <br />
                  Mantén la inercia
                </>
              ) : accuracy >= 70 ? (
                <>
                  <b>✓ Vas muy bien</b>
                  <br />
                  Casi listo para el examen real
                </>
              ) : (
                <>
                  <b>⚠ Sigue practicando</b>
                  <br />
                  Cuanto más entrenes, más subes
                </>
              )}
            </div>
          </div>
        </div>
        <Link className="dash-pill" href={continueHref}>
          <Play className="h-4 w-4 fill-current" />
          {lastTest ? "Continuar donde lo dejaste" : "Empieza tu primer test"}
        </Link>
      </section>

      {/* STREAK */}
      <section className="dash-streak">
        <div className="dash-streak-head">
          <h3>Racha actual</h3>
          <span className="fire" aria-hidden="true">🔥</span>
        </div>
        <h2>
          <b>{streakDays}</b> {streakDays === 1 ? "día" : "días"} seguidos
        </h2>
        <p className="sub">
          {streakDays === 0
            ? "¡Empieza una nueva racha hoy!"
            : streakDays >= 4
            ? "Esta semana — ¡vas a por la quinta!"
            : "Esta semana, sigue así"}
        </p>
        <div className="dash-days" aria-label="Días de la semana">
          {last5.map((d, i) => (
            <div key={i} className={`dash-day ${d.active ? "" : "empty"}`}>
              {d.letter}
            </div>
          ))}
        </div>
        <div className="dash-motivate">
          <Zap className="h-4 w-4" />
          {streakDays === 0 ? "Empieza hoy" : "¡No la rompas hoy!"}
        </div>
      </section>

      {/* ERRORES BANNER */}
      {errorsCount > 0 && (
        <section className="dash-errors dash-full">
          <div className="dash-err-icon" aria-hidden="true">
            <AlertTriangle className="h-10 w-10" />
          </div>
          <div className="dash-err-body">
            <p className="eyebrow">
              Tienes {errorsCount} {errorsCount === 1 ? "error pendiente" : "errores pendientes"}
            </p>
            <p className="desc">
              Repetir lo que fallas es lo que más sube tu nota. Solo te llevará
              unos minutos.
            </p>
          </div>
          <Link className="dash-err-cta" href="/test-errores">
            🎯 Practicar errores ahora →
          </Link>
        </section>
      )}

      {/* CATEGORIES */}
      <div className="dash-section-title">
        <h3>Categorías</h3>
        <Link className="more" href="/temas">Ver por temas →</Link>
      </div>

      <div className="dash-cats">
        {categories.map((c) => {
          const theme   = CATEGORY_THEMES[c.slug] ?? { className: "blue", icon: "📚" }
          const percent = doneByCategory.get(c.id) ?? 0
          const isDone  = percent === 100
          return (
            <Link key={c.id} href={`/${c.slug}`} className={`dash-cat ${theme.className}`}>
              <div>
                <div className="ico">{theme.icon}</div>
                <h4>{c.name}</h4>
                <div className="meta">
                  {c._count.tests} {c._count.tests === 1 ? "test" : "tests"}
                  {c.description ? " · " + c.description.split(".")[0] : ""}
                </div>
              </div>
              <div>
                {isDone ? (
                  <span className="done-chip">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="3"
                      strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    100% completado
                  </span>
                ) : (
                  <>
                    <div className="dash-bar">
                      <i style={{ width: `${percent}%` }} />
                    </div>
                    <div className="progress">{percent}% hechos</div>
                  </>
                )}
              </div>
            </Link>
          )
        })}
      </div>

      {/* ACTIVITY */}
      <section className="dash-activity dash-full">
        <div className="head">
          <h3>Tu actividad reciente</h3>
          <Link href="/historial">Ver historial completo →</Link>
        </div>

        {recentAttempts.length === 0 ? (
          <div style={{ padding: "32px", textAlign: "center", color: "var(--slate-500)" }}>
            Aún no has terminado ningún test. ¡Anímate con el primero!
          </div>
        ) : (
          recentAttempts.map((a) => {
            const ratio = (a.score ?? 0) / a.total
            const light = trafficLight(ratio)
            const href = a.test
              ? `/${a.test.category.slug}/${a.test.testNumber}/resultado/${a.id}`
              : `/historial/${a.id}`
            return (
              <Link key={a.id} href={href} className="dash-row-item">
                <span className={`dash-light ${light}`} aria-hidden="true" />
                <div className="dash-row-title">
                  {a.test
                    ? `${a.test.category.name} · Test ${a.test.testNumber}`
                    : "Test de errores"}
                  <small>
                    {a.mode === "examen"
                      ? "Modo examen real"
                      : a.mode === "errores"
                      ? "Repaso de errores"
                      : "Modo práctica"}
                  </small>
                </div>
                <div className="dash-score">
                  {a.score}/{a.total}
                </div>
                <div className="dash-ts">{timeAgo(a.startedAt)}</div>
              </Link>
            )
          })
        )}
      </section>
    </div>
  )
}
