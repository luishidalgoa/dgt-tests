import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { isAdmin } from "@/lib/permissions"
import { AttemptReview, type ReviewAnswer } from "@/components/AttemptReview"
import type { AttemptMode } from "@/types/exam"

interface PageProps {
  params: Promise<{ categoria: string; testNum: string; attemptId: string }>
}

export default async function ResultPage({ params }: PageProps) {
  const user = await requireUser()
  const admin = isAdmin(user)
  const { categoria, attemptId } = await params
  const id = parseInt(attemptId, 10)
  if (Number.isNaN(id)) notFound()

  const attempt = await db.examAttempt.findFirst({
    where: { id, userId: user.id },
    include: {
      test: { include: { category: true } },
      answers: {
        include: {
          question: {
            include: {
              options: { orderBy: { letra: "asc" } },
            },
          },
          selectedOption: true,
        },
      },
    },
  })

  if (!attempt) notFound()
  if (attempt.test && attempt.test.category.slug !== categoria) notFound()

  // Reordenar las respuestas según el orden canónico del test (no por id)
  let orderedAnswers = attempt.answers
  if (attempt.testId) {
    const testQs = await db.testQuestion.findMany({
      where: { testId: attempt.testId },
      orderBy: { order: "asc" },
      select: { questionId: true, order: true },
    })
    const orderMap = new Map(testQs.map((tq) => [tq.questionId, tq.order]))
    orderedAnswers = [...attempt.answers].sort(
      (a, b) => (orderMap.get(a.questionId) ?? 0) - (orderMap.get(b.questionId) ?? 0)
    )
  }

  const answers: ReviewAnswer[] = orderedAnswers.map((a) => ({
    id:               a.id,
    questionId:       a.questionId,
    selectedOptionId: a.selectedOptionId,
    isCorrect:        a.isCorrect,
    question: {
      id:          a.question.id,
      enunciado:   a.question.enunciado,
      imagen:      a.question.imagen,
      codigoTema:  a.question.codigoTema,
      aiGenerated: a.question.aiGenerated,
      explicacion: a.question.explicacion,
      options:     a.question.options.map((o) => ({
        id:        o.id,
        letra:     o.letra,
        texto:     o.texto,
        isCorrect: o.isCorrect,
      })),
    },
  }))

  return (
    <AttemptReview
      attemptId={attempt.id}
      userId={user.id}
      mode={attempt.mode as AttemptMode}
      startedAt={attempt.startedAt}
      score={attempt.score ?? 0}
      total={attempt.total}
      answers={answers}
      isAdmin={admin}
      test={
        attempt.test
          ? {
              testNumber: attempt.test.testNumber,
              category:   { slug: attempt.test.category.slug, name: attempt.test.category.name },
            }
          : null
      }
    />
  )
}
