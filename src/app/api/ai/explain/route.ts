import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { explainQuestion, type AIExplanationResult } from "@/lib/ai"

const schema = z.object({
  questionId: z.number().int().positive(),
  withImage:  z.boolean().optional().default(false),
})

export async function POST(req: Request) {
  // 1. Solo usuarios logueados (los guests no tienen acceso a la IA)
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json(
      { error: "Necesitas una cuenta para usar la IA" },
      { status: 401 }
    )
  }

  // 2. Validar body
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 })
  }
  const { questionId, withImage } = parsed.data

  // 3. Cache hit
  const cached = await db.aICacheEntry.findUnique({
    where: { questionId_withImage: { questionId, withImage } },
  })
  if (cached) {
    try {
      const result = JSON.parse(cached.payloadJson) as AIExplanationResult
      return NextResponse.json({ cached: true, result })
    } catch {
      // si el JSON está corrupto, lo regeneramos
    }
  }

  // 4. Cargar pregunta con opciones
  const question = await db.question.findUnique({
    where: { id: questionId },
    include: { options: { orderBy: { letra: "asc" } } },
  })
  if (!question) {
    return NextResponse.json({ error: "Pregunta no encontrada" }, { status: 404 })
  }

  const correct = question.options.find((o) => o.isCorrect)
  if (!correct) {
    return NextResponse.json(
      { error: "La pregunta no tiene opción correcta marcada" },
      { status: 500 }
    )
  }

  // 5. Llamar a Gemini
  let result: AIExplanationResult
  try {
    result = await explainQuestion({
      enunciado:    question.enunciado,
      explicacion:  question.explicacion,
      codigoTema:   question.codigoTema,
      options:      question.options.map((o) => ({ letra: o.letra, texto: o.texto })),
      correctLetra: correct.letra,
      imagePath:    withImage && question.imagen ? question.imagen : null,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error al llamar a la IA" },
      { status: 502 }
    )
  }

  // 6. Guardar en cache
  try {
    await db.aICacheEntry.upsert({
      where:  { questionId_withImage: { questionId, withImage } },
      update: { payloadJson: JSON.stringify(result) },
      create: { questionId, withImage, payloadJson: JSON.stringify(result) },
    })
  } catch {
    // no bloqueamos la respuesta al usuario si falla el cache
  }

  return NextResponse.json({ cached: false, result })
}
