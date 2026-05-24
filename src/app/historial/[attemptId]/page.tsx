import { notFound, redirect } from "next/navigation"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { isAdmin } from "@/lib/permissions"
import { AttemptReview, type ReviewAnswer } from "@/components/AttemptReview"
import type { AttemptMode } from "@/types/exam"

interface PageProps {
  params: Promise<{ attemptId: string }>
}

/**
 * Vista de revisión de un intento sin test asociado (modos "errores",
 * "errores-refuerzo" y "tema"). Si el attempt SÍ tiene test asociado,
 * redirige a la URL canónica del modo normal.
 */
export default async function HistoryDetailPage({ params }: PageProps) {
  const user = await requireUser()
  const admin = isAdmin(user)
  const { attemptId } = await params
  const id = parseInt(attemptId, 10)
  if (Number.isNaN(id)) notFound()

  const attempt = await db.examAttempt.findFirst({
    where: { id, userId: user.id },
    include: {
      test: { include: { category: true } },
      answers: {
        orderBy: { id: "asc" },
        include: {
          question: {
            include: {
              options: { orderBy: { letra: "asc" } },
            },
          },
        },
      },
    },
  })

  if (!attempt) notFound()

  if (attempt.test) {
    redirect(`/${attempt.test.category.slug}/${attempt.test.testNumber}/resultado/${attempt.id}`)
  }

  const answers: ReviewAnswer[] = attempt.answers.map((a) => ({
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
      test={null}
    />
  )
}
