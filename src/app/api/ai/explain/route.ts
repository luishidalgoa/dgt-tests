import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { explainQuestion, type AIExplanationResult } from "@/lib/ai"
import { consumeToken, getQuotaStatus } from "@/lib/aiQuota"

const schema = z.object({
  questionId: z.number().int().positive(),
  withImage:  z.boolean().optional().default(false),
})

/**
 * GET /api/ai/explain?questionId=N&withImage=true
 *
 * Solo consulta el cache. No llama a Gemini ni descuenta quota.
 * - 200 con { cached: true, result } si la respuesta está cacheada
 * - 204 si no hay nada cacheado todavía
 */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Necesitas una cuenta" }, { status: 401 })
  }

  const url = new URL(req.url)
  const questionId = Number(url.searchParams.get("questionId") ?? "")
  const withImage  = url.searchParams.get("withImage") === "true"
  if (!Number.isInteger(questionId) || questionId <= 0) {
    return NextResponse.json({ error: "questionId inválido" }, { status: 400 })
  }

  const cached = await db.aICacheEntry.findUnique({
    where: { questionId_withImage: { questionId, withImage } },
  })
  if (!cached) {
    return new NextResponse(null, { status: 204 })
  }
  try {
    const result = JSON.parse(cached.payloadJson) as AIExplanationResult
    const quota = await getQuotaStatus(user.id)
    return NextResponse.json({ cached: true, result, quota })
  } catch {
    return new NextResponse(null, { status: 204 })
  }
}

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

  // 3. Cache hit (no descuenta quota)
  const cached = await db.aICacheEntry.findUnique({
    where: { questionId_withImage: { questionId, withImage } },
  })
  if (cached) {
    try {
      const result = JSON.parse(cached.payloadJson) as AIExplanationResult
      const quota = await getQuotaStatus(user.id)
      return NextResponse.json({ cached: true, result, quota })
    } catch {
      // si el JSON está corrupto, lo regeneramos
    }
  }

  // 4. Comprobar quota mensual ANTES de llamar a Gemini
  const consumed = await consumeToken(user.id)
  if (!consumed) {
    const quota = await getQuotaStatus(user.id)
    return NextResponse.json(
      { error: "Has agotado tu quota mensual de IA. Se reseteará el día 1 del próximo mes.", quota },
      { status: 429 }
    )
  }

  // 5. Cargar pregunta con opciones
  const question = await db.question.findUnique({
    where: { id: questionId },
    include: { options: { orderBy: { letra: "asc" } } },
  })
  if (!question) {
    // Devolver el token (revertimos el consumo)
    await db.user.update({
      where: { id: user.id },
      data:  { aiTokensUsed: { decrement: 1 } },
    })
    return NextResponse.json({ error: "Pregunta no encontrada" }, { status: 404 })
  }

  const correct = question.options.find((o) => o.isCorrect)
  if (!correct) {
    await db.user.update({
      where: { id: user.id },
      data:  { aiTokensUsed: { decrement: 1 } },
    })
    return NextResponse.json(
      { error: "La pregunta no tiene opción correcta marcada" },
      { status: 500 }
    )
  }

  // 6. Llamar a Gemini
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
    // Revertir el consumo si Gemini falla
    await db.user.update({
      where: { id: user.id },
      data:  { aiTokensUsed: { decrement: 1 } },
    })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error al llamar a la IA" },
      { status: 502 }
    )
  }

  // 7. Guardar en cache
  try {
    await db.aICacheEntry.upsert({
      where:  { questionId_withImage: { questionId, withImage } },
      update: { payloadJson: JSON.stringify(result) },
      create: { questionId, withImage, payloadJson: JSON.stringify(result) },
    })
  } catch {
    // no bloqueamos la respuesta al usuario si falla el cache
  }

  return NextResponse.json({ cached: false, result, quota: consumed })
}
