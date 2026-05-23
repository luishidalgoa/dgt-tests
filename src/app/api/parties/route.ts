import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { hasFullAccess } from "@/lib/permissions"
import {
  generateUniquePartyCode,
  pickRandomQuestionIds,
} from "@/lib/party"
import { captureAppException } from "@/lib/sentryUser"

const schema = z.object({
  categoryId:     z.number().int().nullable(),
  totalQuestions: z.number().int().min(5).max(60),
})

export async function POST(req: Request) {
  // Solo usuarios logueados pueden CREAR una party
  const user = await requireUser()

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", issues: parsed.error.issues }, { status: 400 })
  }

  // FREE → solo puede usar preguntas tier=FREE
  // PRO/ADMIN → cualquier pregunta
  const onlyTier = hasFullAccess(user) ? undefined : ("FREE" as const)

  let questionIds: number[]
  try {
    questionIds = await pickRandomQuestionIds(
      parsed.data.totalQuestions,
      parsed.data.categoryId,
      onlyTier
    )
  } catch (e) {
    // Capturamos: si pickRandomQuestionIds peta, indica problema de
    // data integrity (categoría sin preguntas suficientes, FREE tier
    // vacío, BBDD timeout). El user ve un 400 amigable, nosotros nos
    // enteramos por Sentry para arreglar el catálogo / hacer seed.
    captureAppException(e, {
      category: "party",
      tags: {
        operation: "create",
        onlyTier:  onlyTier ?? "all",
      },
      extra: {
        categoryId:     parsed.data.categoryId,
        totalQuestions: parsed.data.totalQuestions,
      },
    })
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  const code = await generateUniquePartyCode()

  const party = await db.party.create({
    data: {
      code,
      hostUserId:     user.id,
      categoryId:     parsed.data.categoryId,
      totalQuestions: questionIds.length,
      questionIds:    JSON.stringify(questionIds),
      status:         "waiting",
      players: {
        create: {
          userId: user.id,
        },
      },
    },
  })

  return NextResponse.json({ code: party.code, id: party.id })
}
