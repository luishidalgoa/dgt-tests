import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import type { AttemptXpReward, SubmitAttemptResponse } from "@/types/exam"
import {
  awardDailyStreakBonusIfDue,
  awardXp,
  computeExamXp,
  getLevel,
  sumXp,
  type AwardXpResult,
} from "@/lib/xp"

const submitSchema = z.object({
  testId: z.number().int().nullable(),
  // Ver src/types/exam.ts para la semántica de cada modo.
  mode:   z.enum(["normal", "errores", "errores-refuerzo", "tema"]),
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

  const { testId, mode, answers } = parsed.data

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

  const redirectUrl =
    validTestId !== null && testNumber !== null
      ? `/${categorySlug}/${testNumber}/resultado/${attempt.id}`
      : `/historial/${attempt.id}`

  // ── XP & nivel ──────────────────────────────────────────────────────
  // Economía:
  //   1. Base por examen = max(0, round(15 - 1.5 × errores)). Aplica a
  //      todos los modos (normal/tema/errores/errores-refuerzo).
  //   2. Bonus diario de racha (una vez por día, solo si el modo cuenta
  //      para stats — ver `awardDailyStreakBonusIfDue` y
  //      `ATTEMPT_STATS_WHERE`): tabla cíclica [5,7,10,15,20,30,50] día
  //      1..7. Día 8 vuelve al 5, etc.
  //
  // Si la BBDD falla al otorgar XP NO tumbamos la respuesta — el
  // examen ya está guardado, los puntos son secundarios. Degradamos
  // a XP=0 con nivel fallback.
  let xpReward: AttemptXpReward
  try {
    const breakdown = computeExamXp({ score, total: answers.length })
    const xpAmount  = sumXp(breakdown)
    const xpResult  = await awardXp(user.id, xpAmount, breakdown[0]?.reason ?? "exam-finish")

    // Tras pagar la base, intenta el bonus diario. Si lo paga,
    // sobreescribe el nivel final con el resultante y añade la línea
    // al breakdown para que el cliente pueda mostrarla por separado.
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
