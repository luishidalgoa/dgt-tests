import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { ATTEMPT_STATS_WHERE } from "@/lib/stats"
import {
  computeStreakDaysOnly,
  awardStreakCreditIfMilestone,
  MAX_RESTORE_CREDITS,
} from "@/lib/streak"
import type { SubmitAttemptResponse } from "@/types/exam"

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

  const response: SubmitAttemptResponse = {
    attemptId: attempt.id,
    score,
    total:     answers.length,
    redirectUrl,
  }
  return NextResponse.json(response)
}
