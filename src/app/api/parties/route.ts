import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import {
  generateUniquePartyCode,
  pickRandomQuestionIds,
} from "@/lib/party"

const schema = z.object({
  categoryId:     z.number().int().nullable(),
  totalQuestions: z.number().int().min(5).max(60),
})

export async function POST(req: Request) {
  // Solo usuarios logueados pueden CREAR una party (los guests solo pueden unirse)
  const user = await requireUser()

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", issues: parsed.error.issues }, { status: 400 })
  }

  let questionIds: number[]
  try {
    questionIds = await pickRandomQuestionIds(parsed.data.totalQuestions, parsed.data.categoryId)
  } catch (e) {
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
