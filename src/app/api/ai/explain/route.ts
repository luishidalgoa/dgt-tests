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
 * POST /api/ai/explain
 *
 * Cada llamada que el usuario hace cuesta 1 token de su quota mensual,
 * AUNQUE la respuesta esté cacheada en BBDD. El cache solo evita gastar
 * dinero llamando a Gemini, pero no exime al usuario del coste.
 *
 * Si Gemini falla (cache miss) o la pregunta no existe, revertimos el
 * consumo para no penalizar al usuario por un fallo del sistema.
 */
export async function POST(req: Request) {
  // 1. Solo usuarios logueados
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

  // 3. Consumir token ANTES de cualquier otra cosa
  const consumed = await consumeToken(user.id)
  if (!consumed) {
    const quota = await getQuotaStatus(user.id)
    return NextResponse.json(
      { error: "Has agotado tu quota mensual de IA. Se reseteará el día 1 del próximo mes.", quota },
      { status: 429 }
    )
  }

  // Helper para revertir el token si algo va mal
  async function refundToken() {
    try {
      await db.user.update({
        where: { id: user!.id },
        data:  { aiTokensUsed: { decrement: 1 } },
      })
    } catch {
      // si no podemos revertir, lo dejamos así
    }
  }

  // 4. Cache hit: devolvemos directamente sin llamar a Gemini
  //    (pero el token YA se ha consumido en el paso 3)
  const cached = await db.aICacheEntry.findUnique({
    where: { questionId_withImage: { questionId, withImage } },
  })
  if (cached) {
    try {
      const result = JSON.parse(cached.payloadJson) as AIExplanationResult
      return NextResponse.json({ cached: true, result, quota: consumed })
    } catch {
      // JSON corrupto, regeneramos vía Gemini abajo
    }
  }

  // 5. Cargar pregunta con opciones (necesario para llamar a Gemini)
  const question = await db.question.findUnique({
    where: { id: questionId },
    include: { options: { orderBy: { letra: "asc" } } },
  })
  if (!question) {
    await refundToken()
    return NextResponse.json({ error: "Pregunta no encontrada" }, { status: 404 })
  }

  const correct = question.options.find((o) => o.isCorrect)
  if (!correct) {
    await refundToken()
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
    await refundToken()
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error al llamar a la IA" },
      { status: 502 }
    )
  }

  // 7. Guardar en cache (no bloqueamos respuesta si falla)
  try {
    await db.aICacheEntry.upsert({
      where:  { questionId_withImage: { questionId, withImage } },
      update: { payloadJson: JSON.stringify(result) },
      create: { questionId, withImage, payloadJson: JSON.stringify(result) },
    })
  } catch {
    // no bloqueamos
  }

  // Devolvemos quota actualizada (puede haber cambiado en otra request en paralelo)
  const quota = await getQuotaStatus(user.id)
  return NextResponse.json({ cached: false, result, quota })
}
