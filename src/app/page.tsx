import Link from "next/link"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { Play, Zap, AlertTriangle, LogIn, UserPlus, Sparkles } from "lucide-react"

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
  const user = await getCurrentUser()

  // ── Modo invitado: dashboard ultra-básico ──────────────────────────────
  if (!user) {
    // Solo los 7 primeros tests de Permiso B, sin más navegación.
    const permisoB = await db.category.findUnique({
      where: { slug: "permiso-b" },
      include: {
        tests: {
          orderBy: { testNumber: "asc" },
          take: 7,
          include: { _count: { select: { testQuestions: true } } },
        },
      },
    })
    return <GuestDashboard category={permisoB} />
  }

  // Categorías + nº de tests (usuarios logueados)
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

  // Actividad: nº exámenes por día (últimos 7) + media diaria
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const weekAttempts = await db.examAttempt.findMany({
    where: { userId: user.id, finishedAt: { not: null }, startedAt: { gte: sevenDaysAgo } },
    select: { startedAt: true },
  })
  const todayMid = new Date()
  todayMid.setHours(0, 0, 0, 0)
  const DAY_LETTERS = ["D", "L", "M", "X", "J", "V", "S"]
  // 7 días: índice 0 = hace 6 días, 6 = hoy
  const last7: { letter: string; count: number; isToday: boolean }[] = []
  for (let i = 6; i >= 0; i--) {
    const day = new Date(todayMid.getTime() - i * 86400000)
    const next = new Date(day.getTime() + 86400000)
    const count = weekAttempts.filter(
      (a) => a.startedAt >= day && a.startedAt < next
    ).length
    last7.push({
      letter: DAY_LETTERS[day.getDay()],
      count,
      isToday: i === 0,
    })
  }
  const weekTotal = last7.reduce((acc, d) => acc + d.count, 0)
  const dailyAvg = weekTotal / 7
  // Racha de días consecutivos hasta hoy con al menos 1 examen
  let streakDays = 0
  for (let i = last7.length - 1; i >= 0; i--) {
    if (last7[i].count > 0) streakDays++
    else break
  }
  const maxDay = Math.max(1, ...last7.map((d) => d.count))

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

      {/* ACTIVIDAD SEMANAL */}
      <section className="dash-streak">
        <div className="dash-streak-head">
          <h3>Actividad esta semana</h3>
          <span className="fire" aria-hidden="true">🔥</span>
        </div>
        <h2>
          <b>{dailyAvg.toFixed(1)}</b> {dailyAvg === 1 ? "test/día" : "tests/día"}
        </h2>
        <p className="sub">
          {weekTotal === 0
            ? "Aún no has hecho ningún test esta semana"
            : `${weekTotal} en los últimos 7 días${streakDays > 1 ? ` · racha de ${streakDays} días` : ""}`}
        </p>
        <div
          className="dash-days"
          aria-label="Tests por día (últimos 7)"
          style={{ alignItems: "flex-end", gap: 6 }}
        >
          {last7.map((d, i) => {
            const isEmpty = d.count === 0
            const heightPct = Math.max(14, (d.count / maxDay) * 100)
            return (
              <div
                key={i}
                className={`dash-day ${isEmpty ? "empty" : ""}`}
                style={{
                  flexDirection: "column",
                  aspectRatio: "auto",
                  height: "auto",
                  alignSelf: "stretch",
                  display: "flex",
                  justifyContent: "flex-end",
                  paddingTop: 6,
                  paddingBottom: 6,
                  position: "relative",
                  outline: d.isToday ? "2px solid var(--orange-600)" : "none",
                  outlineOffset: 1,
                }}
                title={`${d.letter}: ${d.count} test${d.count === 1 ? "" : "s"}`}
              >
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 900,
                    lineHeight: 1,
                    marginBottom: 4,
                  }}
                >
                  {d.count}
                </div>
                <div
                  style={{
                    width: "60%",
                    background: isEmpty ? "transparent" : "rgba(255,255,255,0.7)",
                    height: `${heightPct}%`,
                    maxHeight: 60,
                    borderRadius: 4,
                    marginInline: "auto",
                  }}
                />
                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 800,
                    marginTop: 4,
                    opacity: 0.8,
                  }}
                >
                  {d.letter}
                </div>
              </div>
            )
          })}
        </div>
        <div className="dash-motivate">
          <Zap className="h-4 w-4" />
          {weekTotal === 0
            ? "Empieza hoy"
            : dailyAvg >= 3
            ? "Buen ritmo — sigue así"
            : "Sube la media: 3 tests/día"}
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


// ── Dashboard alternativo para invitados (sin login) ──────────────────────────
type GuestCategoryData = {
  id: number
  slug: string
  name: string
  description: string | null
  tests: { id: number; testNumber: number; _count: { testQuestions: number } }[]
} | null

function GuestDashboard({ category }: { category: GuestCategoryData }) {
  const tests = category?.tests ?? []

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      {/* Hero compacto */}
      <section className="card-soft" style={{ padding: 24, marginBottom: 22 }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 10, margin: 0, fontSize: 22 }}>
          <Sparkles className="h-6 w-6" style={{ color: "var(--amber)" }} />
          Modo invitado
        </h2>
        <p style={{ fontSize: 14.5, lineHeight: 1.55, color: "var(--slate-600)", marginTop: 8, marginBottom: 14 }}>
          Tienes acceso a los <b>7 primeros tests de Permiso B</b> para que pruebes la plataforma.
          Para desbloquear el resto, examen real, historial, IA y competición,{" "}
          <Link href="/register" style={{ color: "var(--orange-600)", fontWeight: 700 }}>crea una cuenta gratis</Link>.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/register" className="btn-primary">
            <UserPlus className="h-4 w-4" />
            Crear cuenta gratis
          </Link>
          <Link href="/login" className="btn-secondary">
            <LogIn className="h-4 w-4" />
            Iniciar sesión
          </Link>
        </div>
      </section>

      {/* Tests permiso B */}
      <h3
        style={{
          margin: "0 4px 12px",
          fontSize: 13,
          fontWeight: 800,
          color: "var(--slate-500)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        Tests disponibles · Permiso B
      </h3>
      <div className="tile-grid">
        {tests.map((t) => (
          <Link
            key={t.id}
            href={`/permiso-b/${t.testNumber}`}
            className="tile"
          >
            <div className="tile-label">Test</div>
            <div className="tile-num">{t.testNumber}</div>
            <div className="tile-pending">{t._count.testQuestions} preguntas</div>
          </Link>
        ))}
      </div>

      {/* Features bloqueadas */}
      <section className="card-soft" style={{ padding: 18, marginTop: 22 }}>
        <h3 style={{ margin: 0, marginBottom: 10, fontSize: 12.5, fontWeight: 800, color: "var(--slate-500)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          🔒 Al iniciar sesión desbloqueas
        </h3>
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
          {[
            { icon: <Sparkles className="h-4 w-4" />, label: "Chatbot IA en práctica" },
            { icon: <Zap className="h-4 w-4" />, label: "Test de errores y temas" },
            { icon: <Play className="h-4 w-4" />, label: "Modo examen con cronómetro" },
            { icon: <AlertTriangle className="h-4 w-4" />, label: "Historial, stats y competición" },
          ].map((it, i) => (
            <li key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--slate-700)" }}>
              <span style={{ color: "var(--orange-600)" }}>{it.icon}</span>
              {it.label}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
