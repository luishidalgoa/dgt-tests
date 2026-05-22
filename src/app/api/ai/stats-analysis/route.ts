import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { ATTEMPT_STATS_WHERE } from "@/lib/stats"
import { consumeTokens, getQuotaStatus } from "@/lib/aiQuota"
import { getActiveProvider } from "@/lib/ai"
import { AIProviderError } from "@/lib/aiProviders/types"
import {
  analyzeStats,
  buildStatsContext,
  MIN_ANSWERS_FOR_ANALYSIS,
  MIN_NEW_ANSWERS_FOR_REFRESH,
  MAX_HISTORY_ITEMS,
  type StatsAnalysisResult,
} from "@/lib/aiStatsAnalysis"

/** Coste del análisis IA del dashboard. */
const COST_TOKENS = 5

/**
 * POST /api/ai/stats-analysis
 *
 * Genera un análisis personalizado del rendimiento del alumno cobrando
 * 5 tokens. Mantiene un historial de hasta MAX_HISTORY_ITEMS análisis
 * por usuario; al insertar el (MAX+1)º se podan los más antiguos.
 *
 * Lógica de "no cobrar":
 *  - Si el análisis más reciente del usuario tiene EXACTAMENTE los mismos
 *    snapshots (totalAttempts/Answers/Correct), devolvemos ese cacheado
 *    sin cobrar — el alumno no ha hecho nada nuevo.
 *  - Si lleva pocas respuestas nuevas (<MIN_NEW_ANSWERS_FOR_REFRESH),
 *    bloqueamos antes de cobrar — análisis casi idéntico.
 *
 * Respuestas:
 *  200 + { result, quota, cached:true, generatedAt, analysisId }   ← sin cobrar
 *  200 + { result, quota, cached:false, generatedAt, analysisId }  ← cobra 5
 *  400 not_enough_data | not_enough_new_data
 *  401 no autenticado
 *  429 quota agotada
 *  502 / 503 errores del provider (códigos ai_*)
 */
export async function POST() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Necesitas una cuenta para usar la IA" }, { status: 401 })
  }

  // 1. Stats actuales del alumno
  const [totalAttempts, totalAnswers, correctAnswers] = await Promise.all([
    db.examAttempt.count({
      where: { userId: user.id, finishedAt: { not: null }, ...ATTEMPT_STATS_WHERE },
    }),
    db.answer.count({
      where: { attempt: { userId: user.id, ...ATTEMPT_STATS_WHERE } },
    }),
    db.answer.count({
      where: { isCorrect: true, attempt: { userId: user.id, ...ATTEMPT_STATS_WHERE } },
    }),
  ])

  // 2. Umbral mínimo absoluto: si el usuario no tiene ningún análisis aún
  //    y lleva pocas respuestas, no permitimos el primero. Si ya hay
  //    historial, el umbral relevante es el de "respuestas nuevas".
  const latest = await db.userAiStatsAnalysis.findFirst({
    where:   { userId: user.id },
    orderBy: { createdAt: "desc" },
  })
  if (!latest && totalAnswers < MIN_ANSWERS_FOR_ANALYSIS) {
    return NextResponse.json(
      {
        error: `Necesitas al menos ${MIN_ANSWERS_FOR_ANALYSIS} respuestas para tu primer análisis. Llevas ${totalAnswers}.`,
        code:  "not_enough_data",
      },
      { status: 400 },
    )
  }

  // 3. Si el más reciente tiene EXACTAMENTE los mismos stats: cacheado gratis
  if (
    latest &&
    latest.totalAttempts  === totalAttempts &&
    latest.totalAnswers   === totalAnswers &&
    latest.correctAnswers === correctAnswers
  ) {
    try {
      const cached = JSON.parse(latest.payloadJson) as StatsAnalysisResult
      const quota  = await getQuotaStatus(user.id)
      return NextResponse.json({
        result:      cached,
        quota,
        cached:      true,
        generatedAt: latest.updatedAt,
        analysisId:  latest.id,
      })
    } catch {
      // payload corrupto → re-generamos
    }
  }

  // 3b. Hay análisis previo con stats DIFERENTES pero apenas algunas
  //     respuestas más. Bloqueamos antes de cobrar — sería un análisis
  //     prácticamente igual al anterior y desperdicia tokens. El front
  //     ya debería deshabilitar el botón; esto es validación defensiva.
  if (latest) {
    const newAnswers = totalAnswers - latest.totalAnswers
    if (newAnswers < MIN_NEW_ANSWERS_FOR_REFRESH) {
      return NextResponse.json(
        {
          error: `Solo has hecho ${newAnswers} respuesta${newAnswers === 1 ? "" : "s"} nueva${newAnswers === 1 ? "" : "s"} desde el último análisis. Practica al menos ${MIN_NEW_ANSWERS_FOR_REFRESH} para que actualizar tenga sentido.`,
          code:        "not_enough_new_data",
          newAnswers,
          needed:      MIN_NEW_ANSWERS_FOR_REFRESH,
        },
        { status: 400 },
      )
    }
  }

  // 4. Cobrar 5 tokens
  const consumed = await consumeTokens(user.id, COST_TOKENS)
  if (!consumed) {
    const quota = await getQuotaStatus(user.id)
    return NextResponse.json(
      {
        error: `Necesitas ${COST_TOKENS} tokens disponibles. Tienes ${quota.remaining}.`,
        quota,
        code:  "not_enough_tokens",
      },
      { status: 429 },
    )
  }

  async function refund() {
    try {
      await db.user.update({
        where: { id: user!.id },
        data:  { aiTokensUsed: { decrement: COST_TOKENS } },
      })
    } catch {
      // si no podemos revertir, lo dejamos así
    }
  }

  // 5. Construir contexto + llamar al provider
  const ctx = await buildStatsContext(user.id, { totalAttempts, totalAnswers, correctAnswers })
  let result: StatsAnalysisResult
  try {
    const provider = await getActiveProvider()
    result = await analyzeStats(provider, ctx)
  } catch (err) {
    await refund()
    console.error("[ai/stats-analysis] error del provider:", err)
    if (err instanceof AIProviderError) {
      switch (err.kind) {
        case "rate_limit":
          return NextResponse.json(
            { error: "La IA no está disponible ahora mismo. Inténtalo en unos minutos.", code: "ai_unavailable" },
            { status: 503 },
          )
        case "misconfigured":
          return NextResponse.json(
            { error: "El servicio de IA está mal configurado. Avisa al administrador.", code: "ai_misconfigured" },
            { status: 503 },
          )
        case "bad_request":
          return NextResponse.json(
            { error: "La IA no pudo procesar tus stats. Inténtalo más tarde.", code: "ai_bad_request" },
            { status: 502 },
          )
        case "server_error":
          return NextResponse.json(
            { error: "Error temporal en el modelo de IA. Inténtalo en unos minutos.", code: "ai_server_error" },
            { status: 502 },
          )
      }
    }
    return NextResponse.json(
      { error: "No se pudo generar el análisis. Inténtalo más tarde.", code: "ai_error" },
      { status: 502 },
    )
  }

  // 6. Insertar el análisis nuevo + podar excedentes (>MAX_HISTORY_ITEMS)
  const provider = await getActiveProvider()
  let inserted: { id: number; updatedAt: Date } | null = null
  try {
    // Cast: la columna contextJson existe en BBDD (migración 20260522210000)
    // pero el Prisma client cached aún no la conoce porque el dev server
    // tiene el DLL bloqueado y npx prisma generate falla con EPERM. Al
    // reiniciar el dev server (postinstall regenera) este cast se elimina.
    inserted = await db.userAiStatsAnalysis.create({
      data: {
        userId:         user.id,
        payloadJson:    JSON.stringify(result),
        contextJson:    JSON.stringify(ctx),
        totalAttempts,
        totalAnswers,
        correctAnswers,
        model:          provider.name,
      } as Parameters<typeof db.userAiStatsAnalysis.create>[0]["data"] & { contextJson: string },
      select: { id: true, updatedAt: true },
    })

    // Poda: si el usuario ya tiene más de MAX, borrar los más antiguos.
    const count = await db.userAiStatsAnalysis.count({ where: { userId: user.id } })
    if (count > MAX_HISTORY_ITEMS) {
      const toDelete = await db.userAiStatsAnalysis.findMany({
        where:   { userId: user.id },
        orderBy: { createdAt: "asc" },
        take:    count - MAX_HISTORY_ITEMS,
        select:  { id: true },
      })
      if (toDelete.length > 0) {
        await db.userAiStatsAnalysis.deleteMany({
          where: { id: { in: toDelete.map((d) => d.id) } },
        })
      }
    }
  } catch (e) {
    // No bloqueamos la respuesta al usuario si falla persistir — devolvemos
    // el análisis igual; el siguiente click volverá a cobrar al no encontrar
    // cacheado, lo cual es un coste aceptable frente a romper la UX ahora.
    console.error("[ai/stats-analysis] falló persistir el análisis:", e)
  }

  const quota = await getQuotaStatus(user.id)
  return NextResponse.json({
    result,
    quota,
    cached:      false,
    generatedAt: inserted?.updatedAt ?? new Date().toISOString(),
    analysisId:  inserted?.id ?? null,
  })
}
