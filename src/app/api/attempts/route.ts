import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import type { AttemptXpReward, SubmitAttemptResponse } from "@/types/exam"
import { ATTEMPT_STATS_WHERE } from "@/lib/stats"
import {
  awardDailyStreakBonusIfDue,
  awardXp,
  computeExamXp,
  getLevel,
  sumXp,
  type AwardXpResult,
} from "@/lib/xp"
import {
  computeStreakDaysOnly,
  awardStreakCreditIfMilestone,
  MAX_RESTORE_CREDITS,
} from "@/lib/streak"

const submitSchema = z.object({
  testId: z.number().int().nullable(),
  // Ver src/types/exam.ts para la semántica de cada modo.
  mode:   z.enum(["normal", "errores", "errores-refuerzo", "tema"]),
  // true sii el intento se hizo como EXAMEN REAL (mode normal con
  // cronómetro de 30 min). Solo en ese caso se concede XP base. Opcional
  // con default false por compatibilidad con clientes antiguos —
  // cualquier intento no marcado se trata como práctica.
  isRealExam: z.boolean().optional().default(false),
  answers: z
    .array(
      z.object({
        questionId:       z.number().int(),
        selectedOptionId: z.number().int().nullable(),
      })
    )
    .min(1),
})

export async function POST(req: Request) {
  // Requiere usuario autenticado
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Body no es JSON válido" }, { status: 400 })
  }

  const parsed = submitSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { testId, mode, answers, isRealExam } = parsed.data

  // Validar que el test existe (si se proporciona)
  let categorySlug = ""
  let testNumber: number | null = null
  let validTestId = testId
  if (testId !== null && testId > 0) {
    const t = await db.test.findUnique({
      where: { id: testId },
      include: { category: true },
    })
    if (!t) {
      return NextResponse.json({ error: "Test no encontrado" }, { status: 404 })
    }
    categorySlug = t.category.slug
    testNumber   = t.testNumber
  } else {
    // testId 0 o negativo → normalizar a null (modo errores)
    validTestId = null
  }

  // Obtener todas las opciones correctas de las preguntas implicadas
  // para calcular isCorrect en una sola query
  const questionIds = answers.map((a) => a.questionId)
  const correctOptions = await db.option.findMany({
    where: { questionId: { in: questionIds }, isCorrect: true },
    select: { id: true, questionId: true },
  })
  const correctByQuestion = new Map<number, number>()
  for (const co of correctOptions) {
    correctByQuestion.set(co.questionId, co.id)
  }

  let score = 0
  const answerRows = answers.map((a) => {
    const correctOptId = correctByQuestion.get(a.questionId)
    const isCorrect =
      a.selectedOptionId !== null && correctOptId === a.selectedOptionId
    if (isCorrect) score++
    return {
      questionId:       a.questionId,
      selectedOptionId: a.selectedOptionId,
      isCorrect,
    }
  })

  // Crear el intento y todas las respuestas en una transacción
  const attempt = await db.$transaction(async (tx) => {
    const created = await tx.examAttempt.create({
      data: {
        userId: user.id,
        testId: validTestId,
        mode,
        total:       answers.length,
        score,
        finishedAt:  new Date(),
      },
    })

    await tx.answer.createMany({
      data: answerRows.map((r) => ({
        ...r,
        attemptId: created.id,
      })),
    })

    return created
  })

  // ── Racha: si este examen ha cruzado un múltiplo de 7 días consecutivos
  //    de racha (7, 14, 21...), +1 crédito de restauración (cap MAX).
  //    Solo cuenta si `mode` es de los que entran en estadísticas, igual
  //    que la racha del dashboard. Fallar este bloque no debe romper la
  //    respuesta del attempt — el examen ya se guardó.
  if (mode === "normal" || mode === "tema") {
    try {
      const now = new Date()
      const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000)
      // Trae los attempts de los últimos 7 días incluyendo el recién
      // creado y calcula el streak antes/después.
      const recent = await db.examAttempt.findMany({
        where: {
          userId:     user.id,
          finishedAt: { not: null },
          startedAt:  { gte: sevenDaysAgo },
          ...ATTEMPT_STATS_WHERE,
        },
        select: { id: true, startedAt: true },
      })
      const allDates = recent.map(a => a.startedAt)
      // Streak ANTES: quita el attempt recién creado.
      const datesBefore = recent
        .filter(a => a.id !== attempt.id)
        .map(a => a.startedAt)
      const oldStreak = computeStreakDaysOnly(
        datesBefore,
        user.streakRestoredUntil,
        now,
      )
      const newStreak = computeStreakDaysOnly(
        allDates,
        user.streakRestoredUntil,
        now,
      )
      const newCredits = awardStreakCreditIfMilestone(
        oldStreak,
        newStreak,
        user.streakRestoreCredits,
      )
      if (newCredits !== user.streakRestoreCredits) {
        await db.user.update({
          where: { id: user.id },
          data:  {
            streakRestoreCredits: Math.min(newCredits, MAX_RESTORE_CREDITS),
          },
        })
      }
    } catch (err) {
      // No bloqueamos la respuesta del POST por un fallo de racha.
      // Sentry recoge el error vía el wrapper del client de Prisma.
      console.warn("[streak] award credit failed:", err)
    }
  }

  const redirectUrl =
    validTestId !== null && testNumber !== null
      ? `/${categorySlug}/${testNumber}/resultado/${attempt.id}`
      : `/historial/${attempt.id}`

  // ── XP & nivel ──────────────────────────────────────────────────────
  // Economía (dos fuentes independientes):
  //   1. Base por examen = max(0, round(15 - 1.5 × errores)). SOLO se
  //      concede cuando es EXAMEN REAL (`isRealExam=true`: modo "normal"
  //      + cronómetro de 30 min). Práctica desde un test, /temas o
  //      /test-errores NO da XP base — son repaso.
  //   2. Bonus diario de racha (una vez por día) si el modo cuenta
  //      para stats (`awardDailyStreakBonusIfDue` lo decide via
  //      `ATTEMPT_STATS_WHERE`): tabla cíclica [5,7,10,15,20,30,50].
  //      Aplica a cualquier examen normal/tema independientemente de
  //      si fue real o práctica — lo importante es mantener la racha.
  //
  // Si la BBDD falla al otorgar XP NO tumbamos la respuesta — el
  // examen ya está guardado, los puntos son secundarios. Degradamos
  // a XP=0 con nivel fallback.
  let xpReward: AttemptXpReward
  try {
    const breakdown = isRealExam
      ? computeExamXp({ score, total: answers.length })
      : []
    const xpAmount  = sumXp(breakdown)
    // Si no hay base que dar (práctica), awardXp con amount=0 es un
    // no-op y solo nos devuelve el estado actual del nivel.
    const xpResult  = await awardXp(
      user.id,
      xpAmount,
      breakdown[0]?.reason ?? "exam-finish",
    )

    // Tras pagar la base (si tocaba), intenta el bonus diario. Si lo
    // paga, sobreescribe el nivel final con el resultante y añade la
    // línea al breakdown para que el cliente pueda mostrarla.
    let finalState: AwardXpResult = xpResult
    const streakResult = await awardDailyStreakBonusIfDue(user.id)
    if (streakResult) {
      finalState = streakResult
      breakdown.push({ reason: "streak-day", amount: streakResult.newXp - streakResult.oldXp })
    }

    xpReward = {
      awarded:   finalState.newXp - xpResult.oldXp,
      breakdown,
      leveledUp: finalState.newLevel > xpResult.oldLevel,
      oldLevel:  xpResult.oldLevel,
      newLevel:  finalState.newLevel,
      iconPath:  finalState.levelInfo.iconPath,
      levelLabel: finalState.levelInfo.label,
    }
  } catch (err) {
    // No tumbar la respuesta — el cliente vería el examen como "no
    // guardado" pero sí está guardado. Logueamos y devolvemos XP=0.
    console.error("[xp] failed to award XP for attempt", attempt.id, err)
    const fallbackLevel = getLevel(0)
    xpReward = {
      awarded:    0,
      breakdown:  [],
      leveledUp:  false,
      oldLevel:   fallbackLevel.level,
      newLevel:   fallbackLevel.level,
      iconPath:   fallbackLevel.iconPath,
      levelLabel: fallbackLevel.label,
    }
  }

  const response: SubmitAttemptResponse = {
    attemptId: attempt.id,
    score,
    total:     answers.length,
    redirectUrl,
    xp:        xpReward,
  }
  return NextResponse.json(response)
}
