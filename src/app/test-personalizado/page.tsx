import Link from "next/link"
import { redirect } from "next/navigation"
import { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { QUESTION_VISIBLE_WHERE, SQL_QUESTION_VISIBLE_AND } from "@/lib/questions"
import { SQL_ATTEMPT_STATS_AND } from "@/lib/stats"
import { shuffle } from "@/lib/shuffle"
import { ExamRunner } from "@/components/ExamRunner"
import { hasFullAccess, getEffectiveTokenQuota } from "@/lib/permissions"
import { getQuotaStatus } from "@/lib/aiQuota"
import { buildStatsContext, type StatsContext } from "@/lib/aiStatsAnalysis"
import { Badge } from "@/components/ui/badge"
import {
  ChevronLeft,
  Target,
  Sparkles,
  AlertTriangle,
} from "lucide-react"
import type { TestRunnerData } from "@/types/exam"

export const dynamic = "force-dynamic"

interface PageProps {
  searchParams: Promise<{ analysisId?: string; n?: string }>
}

const DEFAULT_SIZES = [10, 20, 30, 40] as const
const RATIO_WEAK = 0.85

/**
 * Test personalizado a partir de un análisis IA del usuario.
 *
 * Flujo:
 *  - Sin ?n → selector de tamaño (10/20/30)
 *  - Con ?n → genera test:
 *      · 85% preguntas de los topWeakBlocks del análisis (distribuidas
 *        proporcionalmente por cantidad ABSOLUTA de fallos)
 *      · 15% preguntas de sub-bloques que el usuario aún NO ha practicado
 *        (introducir contenido nuevo, evita repetir siempre lo mismo)
 *
 * Sin coste IA: usamos el contextJson guardado del análisis (que ya tiene
 * los topWeakBlocks) y reutilizamos el SQL determinista. Si el análisis es
 * antiguo y no tiene contextJson, recalculamos al vuelo desde BBDD.
 *
 * El attempt se guarda con mode="tema" — cuenta para stats normales.
 */
export default async function TestPersonalizadoPage({ searchParams }: PageProps) {
  const user = await requireUser()
  if (!hasFullAccess(user)) redirect("/upgrade")

  const sp = await searchParams
  const analysisId = sp.analysisId ? parseInt(sp.analysisId, 10) : null
  const requested  = sp.n ? Math.max(1, Math.min(parseInt(sp.n, 10), 60)) : null

  // 1) Cargar el análisis (el indicado o el más reciente del usuario)
  const analysis = analysisId !== null && Number.isFinite(analysisId)
    ? await db.userAiStatsAnalysis.findFirst({
        where: { id: analysisId, userId: user.id },
      })
    : await db.userAiStatsAnalysis.findFirst({
        where:   { userId: user.id },
        orderBy: { createdAt: "desc" },
      })

  if (!analysis) {
    return (
      <div>
        <Link href="/" className="back-link"><ChevronLeft className="h-4 w-4" /> Inicio</Link>
        <div className="empty-state" style={{ marginTop: 18, borderColor: "rgba(239, 68, 68, 0.35)" }}>
          <AlertTriangle className="h-10 w-10 mx-auto" style={{ color: "var(--red-500)" }} />
          <h2 style={{ fontSize: 20, fontWeight: 800, margin: "10px 0 6px", color: "var(--ink)" }}>
            No tienes ningún análisis IA todavía
          </h2>
          <p style={{ margin: "0 0 16px", color: "var(--slate-600)" }}>
            Genera tu primer análisis desde el dashboard para desbloquear los tests personalizados.
          </p>
          <Link href="/" className="btn-primary" style={{ display: "inline-flex" }}>
            Ir al dashboard →
          </Link>
        </div>
      </div>
    )
  }

  // 2) Recuperar el contexto guardado (topWeakBlocks). Si no lo hay
  //    (análisis pre-Fase 111), recalcular al vuelo desde BBDD.
  // Cast: el row tiene contextJson (existe en BBDD), pero el Prisma client
  // cached aún no lo expone (DLL bloqueado por el dev server). Al reiniciar
  // se regenera y este cast se elimina.
  const ctx = await loadOrRebuildContext(
    user.id,
    analysis as typeof analysis & { contextJson: string | null },
  )
  const topWeak = ctx.topWeakBlocks

  if (topWeak.length === 0) {
    return (
      <div>
        <Link href="/" className="back-link"><ChevronLeft className="h-4 w-4" /> Inicio</Link>
        <div className="empty-state" style={{ marginTop: 18, borderColor: "rgba(34, 197, 94, 0.35)" }}>
          <Sparkles className="h-10 w-10 mx-auto" style={{ color: "var(--green)" }} />
          <h2 style={{ fontSize: 20, fontWeight: 800, margin: "10px 0 6px", color: "var(--ink)" }}>
            No tienes sub-bloques con fallos
          </h2>
          <p style={{ margin: "0 0 16px", color: "var(--slate-600)" }}>
            Sin debilidades detectadas no podemos personalizar el test. Sigue practicando con /test-errores.
          </p>
          <Link href="/test-errores" className="btn-primary" style={{ display: "inline-flex" }}>
            Ir a Test de errores →
          </Link>
        </div>
      </div>
    )
  }

  // ── Caso A: no se pidió tamaño → selector ───────────────────────────
  if (!requested) {
    return (
      <div>
        <Link href="/" className="back-link"><ChevronLeft className="h-4 w-4" /> Inicio</Link>
        <header className="page-header">
          <div>
            <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Target className="h-7 w-7" style={{ color: "var(--orange-600)" }} />
              Test personalizado
            </h1>
            <p className="lead">
              Generado a partir de tu análisis del{" "}
              <b>{analysis.createdAt.toLocaleDateString("es-ES", { dateStyle: "long" })}</b>.
            </p>
          </div>
        </header>

        <div className="card-soft warm" style={{ padding: 28 }}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11.5, color: "var(--slate-500)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
              Composición del test
            </div>
            <p style={{ margin: 0, color: "var(--slate-700)", fontSize: 13.5, lineHeight: 1.55 }}>
              85% preguntas de los <b>{topWeak.length} sub-bloques donde más fallas</b> (proporcional a la cantidad de fallos) + 15% preguntas de <b>sub-bloques que aún no has practicado</b>.
            </p>
          </div>

          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10, color: "var(--slate-700)" }}>
              ¿Cuántas preguntas?
            </div>
            <div className="flex flex-wrap gap-2">
              {DEFAULT_SIZES.map((n) => (
                <Link
                  key={n}
                  href={`/test-personalizado?n=${n}${analysisId !== null ? `&analysisId=${analysisId}` : ""}`}
                  className={n === DEFAULT_SIZES[DEFAULT_SIZES.length - 1] ? "btn-primary" : "btn-secondary"}
                >
                  {n}
                </Link>
              ))}
            </div>
          </div>

          <p style={{ fontSize: 12, color: "var(--slate-500)", marginTop: 18, marginBottom: 0 }}>
            Las preguntas se eligen priorizando las que has fallado más veces. Coste: <b>0 tokens IA</b>.
          </p>
        </div>
      </div>
    )
  }

  // ── Caso B: se pidió tamaño → seleccionar preguntas y montar runner ──
  const selectedIds = await pickQuestionIds({
    userId:    user.id,
    topWeak:   topWeak.map((b) => ({ codigoTema: b.codigoTema, fallos: b.fallos })),
    desiredN:  requested,
    ratioWeak: RATIO_WEAK,
  })

  if (selectedIds.length === 0) {
    return (
      <div>
        <Link href="/" className="back-link"><ChevronLeft className="h-4 w-4" /> Inicio</Link>
        <div className="empty-state" style={{ marginTop: 18 }}>
          <AlertTriangle className="h-10 w-10 mx-auto" style={{ color: "var(--amber)" }} />
          <h2 style={{ fontSize: 20, fontWeight: 800, margin: "10px 0", color: "var(--ink)" }}>
            No se pudieron seleccionar preguntas
          </h2>
          <p style={{ color: "var(--slate-600)" }}>
            Quizá los sub-bloques de tu análisis no tienen preguntas visibles ahora mismo. Genera un análisis nuevo desde el dashboard.
          </p>
        </div>
      </div>
    )
  }

  const questions = await db.question.findMany({
    where:   { id: { in: selectedIds }, ...QUESTION_VISIBLE_WHERE },
    include: { options: { orderBy: { letra: "asc" } } },
  })
  // Mantener el orden de pickQuestionIds (shuffled)
  const orderMap = new Map(selectedIds.map((id, i) => [id, i]))
  questions.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0))

  const data: TestRunnerData = {
    test: {
      id:             0,
      testNumber:     0,
      totalQuestions: questions.length,
      category: {
        slug: "test-personalizado",
        name: "Test personalizado",
        code: "PERSONALIZADO",
      },
    },
    questions: questions.map((q) => ({
      id:              q.id,
      externalId:      q.externalId,
      enunciado:       q.enunciado,
      imagen:          q.imagen,
      codigoTema:      q.codigoTema,
      options:         q.options.map((o) => ({ id: o.id, letra: o.letra, texto: o.texto })),
      correctOptionId: q.options.find((o) => o.isCorrect)?.id ?? null,
      explicacion:     q.explicacion ?? null,
      aiGenerated:     q.aiGenerated,
    })),
  }

  return (
    <div className="space-y-4">
      <Link
        href={`/test-personalizado${analysisId !== null ? `?analysisId=${analysisId}` : ""}`}
        className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
      >
        <ChevronLeft className="h-4 w-4" />
        Volver
      </Link>
      <div className="flex items-center gap-2 text-sm text-orange-700 flex-wrap">
        <Target className="h-4 w-4" />
        <span>Test personalizado · {questions.length} preguntas</span>
        <Badge variant="outline" className="text-orange-700 border-orange-200">
          basado en tu análisis IA
        </Badge>
      </div>
      <ExamRunner
        data={data}
        mode="tema"
        aiQuota={getEffectiveTokenQuota(user)}
        aiQuotaRemaining={(await getQuotaStatus(user.id)).remaining}
      />
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Devuelve el contexto del análisis. Si el análisis tiene contextJson
 * guardado (Fase 111+), lo deserializa. Si no (análisis antiguo), recalcula
 * al vuelo desde BBDD usando los snapshots de stats.
 */
async function loadOrRebuildContext(
  userId:   number,
  analysis: { contextJson: string | null; totalAttempts: number; totalAnswers: number; correctAnswers: number },
): Promise<StatsContext> {
  if (analysis.contextJson) {
    try {
      return JSON.parse(analysis.contextJson) as StatsContext
    } catch {
      // contextJson corrupto → recalculamos
    }
  }
  return buildStatsContext(userId, {
    totalAttempts:  analysis.totalAttempts,
    totalAnswers:   analysis.totalAnswers,
    correctAnswers: analysis.correctAnswers,
  })
}

/**
 * Selecciona los questionIds del test personalizado.
 *
 * - 85% de los slots: distribuidos entre los topWeakBlocks según peso
 *   proporcional a `fallos` absolutos. Dentro de cada bloque, las
 *   preguntas se ordenan poniendo primero las que el user ha FALLADO
 *   más veces (subquery COUNT WHERE isCorrect=0), tie-break random.
 * - 15% de los slots: preguntas de sub-bloques (codigoTema) que el user
 *   nunca ha respondido. Random shuffle.
 *
 * Si alguna parte no llena su cupo (p.ej. bloques con pocas preguntas
 * disponibles), el déficit se rellena con la otra parte. Devuelve los
 * IDs en orden ya barajado para el runner.
 */
async function pickQuestionIds(args: {
  userId:    number
  topWeak:   { codigoTema: string; fallos: number }[]
  desiredN:  number
  ratioWeak: number
}): Promise<number[]> {
  const { userId, topWeak, desiredN, ratioWeak } = args
  const nWeak = Math.round(desiredN * ratioWeak)
  const nNew  = desiredN - nWeak

  // 1) Reparto proporcional dentro de topWeak por cantidad de fallos
  const totalWeight = topWeak.reduce((s, b) => s + b.fallos, 0)
  const perBlock: { codigoTema: string; cantidad: number }[] = []
  if (totalWeight > 0) {
    for (const b of topWeak) {
      perBlock.push({
        codigoTema: b.codigoTema,
        cantidad:   Math.round((nWeak * b.fallos) / totalWeight),
      })
    }
    // Ajustar redondeo: la suma puede diferir de nWeak por 1-2
    let diff = nWeak - perBlock.reduce((s, b) => s + b.cantidad, 0)
    let idx  = 0
    while (diff !== 0 && perBlock.length > 0) {
      perBlock[idx].cantidad += Math.sign(diff)
      diff -= Math.sign(diff)
      idx = (idx + 1) % perBlock.length
    }
  }

  // 2) Por cada bloque, cargar preguntas priorizando las falladas por el user
  const weakIds: number[] = []
  for (const b of perBlock) {
    if (b.cantidad <= 0) continue
    const rows = await db.$queryRaw<{ id: number }[]>`
      SELECT q.id AS id
      FROM questions q
      LEFT JOIN answers a
        ON a.questionId = q.id
        AND a.isCorrect = 0
        AND a.attemptId IN (
          SELECT ea.id FROM exam_attempts ea
          WHERE ea.userId = ${userId} ${Prisma.raw(SQL_ATTEMPT_STATS_AND)}
        )
      WHERE q.codigoTema = ${b.codigoTema}
        ${Prisma.raw(SQL_QUESTION_VISIBLE_AND)}
      GROUP BY q.id
      ORDER BY COUNT(a.id) DESC, RANDOM()
      LIMIT ${b.cantidad}
    `
    for (const r of rows) weakIds.push(r.id)
  }

  // 3) 15% de bloques no practicados (sub-bloques nuevos)
  //    Excluir explícitamente los IDs ya elegidos en (2) para no repetir.
  const newIds: number[] = []
  if (nNew > 0) {
    const exclude = weakIds.length > 0 ? Prisma.sql`AND q.id NOT IN (${Prisma.join(weakIds)})` : Prisma.empty
    const rows = await db.$queryRaw<{ id: number }[]>`
      SELECT q.id AS id
      FROM questions q
      WHERE q.id NOT IN (
        SELECT a.questionId FROM answers a
        INNER JOIN exam_attempts ea ON ea.id = a.attemptId
        WHERE ea.userId = ${userId}
      )
      ${exclude}
      ${Prisma.raw(SQL_QUESTION_VISIBLE_AND)}
      ORDER BY RANDOM()
      LIMIT ${nNew}
    `
    for (const r of rows) newIds.push(r.id)
  }

  // 4) Si alguna parte se quedó corta, rellenar con la otra (best-effort).
  const combined = [...weakIds, ...newIds]
  if (combined.length < desiredN) {
    const deficit = desiredN - combined.length
    const extra = await db.$queryRaw<{ id: number }[]>`
      SELECT q.id AS id
      FROM questions q
      ${combined.length > 0
        ? Prisma.sql`WHERE q.id NOT IN (${Prisma.join(combined)})`
        : Prisma.empty}
      ${combined.length > 0 ? Prisma.raw(SQL_QUESTION_VISIBLE_AND) : Prisma.raw(`WHERE 1=1 ${SQL_QUESTION_VISIBLE_AND}`)}
      ORDER BY RANDOM()
      LIMIT ${deficit}
    `
    for (const r of extra) combined.push(r.id)
  }

  return shuffle(combined).slice(0, desiredN)
}
