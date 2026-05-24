import Link from "next/link"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { ATTEMPT_STATS_WHERE } from "@/lib/stats"
import { getQuotaStatus } from "@/lib/aiQuota"
import { Play, Zap, AlertTriangle, LogIn, UserPlus, Sparkles } from "lucide-react"
import { ContinueExamPill } from "@/components/ContinueExamPill"
import { DashStatsAnalysis, type StatsAnalysisResult, type AnalysisHistoryItem } from "@/components/DashStatsAnalysis"
import { MAX_HISTORY_ITEMS } from "@/lib/aiStatsAnalysis"
import { StructuredDataHome } from "@/components/StructuredData"
import { StreakIcon } from "@/components/StreakIcon"
import { RestoreStreakButton } from "@/components/RestoreStreakButton"
import { computeStreakState } from "@/lib/streak"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://dgt-tests.vercel.app"

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
    return (
      <>
        <StructuredDataHome appUrl={APP_URL} />
        <GuestDashboard category={permisoB} />
      </>
    )
  }

  // Categorías + nº de tests (usuarios logueados)
  const categories = await db.category.findMany({
    include: { _count: { select: { tests: true } } },
    orderBy: { id: "asc" },
  })

  // Stats del usuario. Excluye los attempts del modo "errores"
  // (/test-errores) del cálculo de racha + % aciertos — son práctica
  // de repaso, no representan rendimiento en examen. Ver src/lib/stats.ts.
  const [totalAttempts, totalAnswers, correctAnswers, recentAttempts] = await Promise.all([
    db.examAttempt.count({
      where: { userId: user.id, finishedAt: { not: null }, ...ATTEMPT_STATS_WHERE },
    }),
    db.answer.count({
      where: { attempt: { userId: user.id, ...ATTEMPT_STATS_WHERE } },
    }),
    db.answer.count({
      where: { attempt: { userId: user.id, ...ATTEMPT_STATS_WHERE }, isCorrect: true },
    }),
    db.examAttempt.findMany({
      where: { userId: user.id, finishedAt: { not: null }, ...ATTEMPT_STATS_WHERE },
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

  // Actividad: nº exámenes por día (últimos 7) + media diaria + racha.
  // `new Date()` aquí es Server Component dinámico (force-dynamic): cada
  // request se sirve fresco y necesitamos la hora actual del servidor.
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const weekAttempts = await db.examAttempt.findMany({
    where: {
      userId:     user.id,
      finishedAt: { not: null },
      startedAt:  { gte: sevenDaysAgo },
      ...ATTEMPT_STATS_WHERE,
    },
    select: { startedAt: true },
  })
  // Toda la lógica de racha (last7, streakDays, frozen, canRestore) vive
  // ya en src/lib/streak.ts. El dashboard solo pasa attempts + estado del
  // user y obtiene el shape listo para renderizar.
  const streak = computeStreakState(
    weekAttempts.map(a => a.startedAt),
    user.streakRestoredUntil,
    now,
    { credits: user.streakRestoreCredits }
  )
  const { last7, weekTotal, dailyAvg, streakDays, maxDay, frozen, canRestore } = streak

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

  // Análisis IA de stats — cargamos el HISTORIAL (hasta MAX_HISTORY_ITEMS,
  // más recientes primero) + la quota restante. El componente del cliente
  // decide qué mostrar expandido y qué colapsar.
  const [aiStatsRows, aiQuota] = await Promise.all([
    db.userAiStatsAnalysis.findMany({
      where:   { userId: user.id },
      orderBy: { createdAt: "desc" },
      take:    MAX_HISTORY_ITEMS,
    }),
    getQuotaStatus(user.id),
  ])
  const aiStatsHistory: AnalysisHistoryItem[] = []
  for (const row of aiStatsRows) {
    try {
      aiStatsHistory.push({
        id:              row.id,
        result:          JSON.parse(row.payloadJson) as StatsAnalysisResult,
        generatedAt:     row.updatedAt.toISOString(),
        snapshotAnswers: row.totalAnswers,
        snapshotAttempts: row.totalAttempts,
        snapshotCorrect: row.correctAnswers,
        model:           row.model,
      })
    } catch {
      // payload corrupto, se omite del listado
    }
  }

  return (
    <>
      {/* JSON-LD también para usuarios logueados — Google no llega aquí
          (auth-gated) pero si rastrea por algún cache antiguo, sigue
          encontrando los schemas del sitio. */}
      <StructuredDataHome appUrl={APP_URL} />
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
        <ContinueExamPill
          fallbackHref={continueHref}
          fallbackLabel={lastTest ? "Continuar donde lo dejaste" : "Empieza tu primer test"}
        />

        <DashStatsAnalysis
          history={aiStatsHistory}
          totalAnswers={totalAnswers}
          aiQuotaRemaining={aiQuota.remaining}
        />
      </section>

      {/* ACTIVIDAD SEMANAL */}
      <section className="dash-streak">
        <div className="dash-streak-head">
          <h3>Actividad esta semana</h3>
          <span className="fire">
            <StreakIcon
              frozen={frozen}
              ariaLabel={
                frozen
                  ? "Racha en peligro: aún no has hecho ningún examen hoy"
                  : "Racha activa"
              }
            />
          </span>
        </div>
        <h2>
          <b>{dailyAvg.toFixed(1)}</b> {dailyAvg === 1 ? "test/día" : "tests/día"}
        </h2>
        <p className="sub">
          {weekTotal === 0
            ? "Aún no has hecho ningún test esta semana"
            : `${weekTotal} en los últimos 7 días${streakDays > 1 ? ` · racha de ${streakDays} días` : ""}`}
        </p>
        {canRestore && (
          <RestoreStreakButton credits={user.streakRestoreCredits} />
        )}
        <div
          className="dash-days"
          aria-label="Tests por día (últimos 7)"
          style={{ alignItems: "flex-end", gap: 6 }}
        >
          {last7.map((d, i) => {
            const isEmpty = d.count === 0
            const heightPct = Math.max(14, (d.count / maxDay) * 100)
            const title = d.restored
              ? `${d.letter}: día restaurado con crédito`
              : `${d.letter}: ${d.count} test${d.count === 1 ? "" : "s"}`
            return (
              <div
                key={i}
                className={`dash-day ${isEmpty && !d.restored ? "empty" : ""}`}
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
                title={title}
              >
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 900,
                    lineHeight: 1,
                    marginBottom: 4,
                  }}
                >
                  {d.restored ? "❄" : d.count}
                </div>
                <div
                  style={{
                    width: "60%",
                    background: d.restored
                      ? "repeating-linear-gradient(45deg, rgba(125,211,252,0.55) 0 4px, rgba(255,255,255,0.3) 4px 8px)"
                      : isEmpty
                        ? "transparent"
                        : "rgba(255,255,255,0.7)",
                    height: `${d.restored ? 30 : heightPct}%`,
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
    </>
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

/**
 * Versión guest de la home con TRIPLE rol:
 *   1. SEO: la única página totalmente indexable por Google. Necesita H1
 *      con keyword principal + 300-500 palabras de texto real para que
 *      Google entienda de qué va el sitio y rankee long-tail queries.
 *      Sin esto Google la marca como "thin content" y la deja muerta.
 *   2. Conversión: CTAs claras "Crear cuenta gratis" / "Iniciar sesión",
 *      manteniendo el hero compacto que ya funcionaba.
 *   3. Funcional: lista de los 7 tests free para que el guest pueda
 *      probar inmediatamente sin convertir todavía.
 */
function GuestDashboard({ category }: { category: GuestCategoryData }) {
  const tests = category?.tests ?? []

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      {/* HERO + H1 SEO. Antes era <h2>Modo invitado</h2> — pero Google
          necesita exactamente UN <h1> por página con la keyword principal
          arriba. Esto pasa a ser el ancla SEO de toda la web. */}
      <section className="card-soft" style={{ padding: 28, marginBottom: 22 }}>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2, letterSpacing: "-0.02em" }}>
          Tests del examen teórico DGT —{" "}
          <span style={{ color: "var(--orange-600)" }}>gratis y online</span>
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.55, color: "var(--slate-600)", marginTop: 12, marginBottom: 16 }}>
          Practica con preguntas reales del examen teórico del{" "}
          <b>carné de conducir Permiso B</b>, sin registro y sin descargar nada.
          Empieza ahora mismo con <b>7 tests gratuitos</b> y, si quieres más
          (ADAS, Repaso final, manual completo, test de errores), créate
          una cuenta — el plan gratis es para siempre.
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

      {/* Tests permiso B — bloque funcional, manteniendo el diseño que ya
          existía. Lo subo a <h2> (en vez del eyebrow visual) porque para
          el outline SEO importa que sea heading real. */}
      <h2
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
      </h2>
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

      {/* Features bloqueadas — mantengo el bloque visual, pero el heading
          es ahora <h2> semántico (era <h3> de eyebrow). */}
      <section className="card-soft" style={{ padding: 18, marginTop: 22 }}>
        <h2 style={{ margin: 0, marginBottom: 10, fontSize: 12.5, fontWeight: 800, color: "var(--slate-500)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          🔒 Al iniciar sesión desbloqueas
        </h2>
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

      {/* ── SECCIÓN SEO: contenido textual indexable ─────────────────────
          Las 3 secciones siguientes son TEXTO REAL para que Google
          entienda de qué va la web. Imprescindible para no caer en
          "thin content" — la home pasa de ~50 a ~450 palabras. */}

      <section style={{ marginTop: 36, padding: "0 4px" }}>
        <h2 style={{ fontSize: 22, margin: "0 0 10px", letterSpacing: "-0.01em" }}>
          Qué es DGT Tests
        </h2>
        <p style={{ fontSize: 14.5, lineHeight: 1.65, color: "var(--slate-700)", margin: 0 }}>
          DGT Tests es una plataforma online para preparar el{" "}
          <b>examen teórico del carné de conducir</b> en España. Reproducimos
          fielmente las preguntas oficiales del banco de la Dirección General
          de Tráfico, organizadas por categorías: <b>Permiso B</b> (turismos),
          <b> Repaso final</b> (mix exigente para los últimos días antes del
          examen) y <b>ADAS</b> (preguntas específicas sobre sistemas
          avanzados de asistencia a la conducción, incluidas en el examen
          desde 2022). Todas las preguntas llevan{" "}
          <b>explicación detallada</b> y feedback inmediato, así no solo
          aciertas: entiendes <em>por qué</em>.
        </p>
      </section>

      <section style={{ marginTop: 28, padding: "0 4px" }}>
        <h2 style={{ fontSize: 22, margin: "0 0 14px", letterSpacing: "-0.01em" }}>
          Cómo funciona
        </h2>
        <ol style={{ margin: 0, paddingLeft: 22, fontSize: 14.5, lineHeight: 1.6, color: "var(--slate-700)" }}>
          <li style={{ marginBottom: 8 }}>
            <b>Elige modo</b> (práctica o examen real con cronómetro de 30 min)
            y empieza el test sin instalar nada.
          </li>
          <li style={{ marginBottom: 8 }}>
            <b>Responde 30 preguntas</b> — las mismas que verás el día del
            examen. Como en la DGT real, el aprobado está en 27/30 (máximo 3
            fallos).
          </li>
          <li style={{ marginBottom: 8 }}>
            <b>Repasa con la IA</b>: si una pregunta no te queda clara, pide
            al chatbot que te la explique con tus propias palabras.
          </li>
          <li>
            <b>Revisa tus errores</b> en cualquier momento desde el historial
            — los repites hasta que te los sepas.
          </li>
        </ol>
      </section>

      <section style={{ marginTop: 28, padding: "0 4px" }}>
        <h2 style={{ fontSize: 22, margin: "0 0 12px", letterSpacing: "-0.01em" }}>
          Sobre el examen teórico DGT
        </h2>
        <p style={{ fontSize: 14.5, lineHeight: 1.65, color: "var(--slate-700)", margin: 0 }}>
          El examen teórico del Permiso B consta de <b>30 preguntas tipo test</b>{" "}
          y se aprueba con <b>27 aciertos</b> (3 fallos máximo). La prueba se
          hace en un ordenador en la Jefatura de Tráfico, dura{" "}
          <b>30 minutos</b> y cubre el manual oficial completo: normativa,
          señales, mecánica básica, conducción segura y, desde 2022, sistemas
          ADAS. Si suspendes puedes volver a presentarte, pero el coste de
          las tasas se suma. Nuestro objetivo: que apruebes a la primera
          haciendo tests reales hasta que el patrón de respuestas se te
          vuelva intuitivo.
        </p>
      </section>

      <section style={{ marginTop: 28, marginBottom: 8, padding: "0 4px" }}>
        <h2 style={{ fontSize: 22, margin: "0 0 12px", letterSpacing: "-0.01em" }}>
          Por qué practicar online
        </h2>
        <ul style={{ margin: 0, paddingLeft: 22, fontSize: 14.5, lineHeight: 1.6, color: "var(--slate-700)" }}>
          <li style={{ marginBottom: 6 }}>
            <b>Gratis para empezar</b>: 7 tests sin tarjeta, sin trial limitado
            y sin spam por email.
          </li>
          <li style={{ marginBottom: 6 }}>
            <b>Sin descargas</b>: funciona desde el móvil, tablet u ordenador
            con cualquier navegador.
          </li>
          <li style={{ marginBottom: 6 }}>
            <b>Hecho en 2026</b>: preguntas actualizadas con las últimas
            modificaciones del temario (incluido el bloque ADAS).
          </li>
          <li>
            <b>Aprende razonando</b>: la IA explica el porqué de cada
            respuesta, no solo te dice si está bien o mal.
          </li>
        </ul>
      </section>

      {/* CTA al /faq. Dos motivos:
           1. UX: visitante con dudas residuales tras leer las 4 secciones
              SEO ya tiene un sitio claro a donde ir antes de irse a Google.
           2. SEO: el internal linking desde la home (la página con más
              autoridad) hacia /faq le pasa "link juice" y acelera la
              indexación de las 12 preguntas. */}
      <section
        className="card-soft warm"
        style={{
          marginTop:      32,
          padding:        18,
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          gap:            14,
          flexWrap:       "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <p style={{ margin: 0, fontWeight: 800, fontSize: 15 }}>
            ¿Te queda alguna duda sobre el examen?
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--slate-600)" }}>
            Cuántos fallos puedes tener, qué es ADAS, cuánto cuesta el carné,
            plazos y trámites — todo resuelto en una página.
          </p>
        </div>
        <Link href="/faq" className="btn-secondary" style={{ whiteSpace: "nowrap" }}>
          Preguntas frecuentes →
        </Link>
      </section>
    </div>
  )
}
