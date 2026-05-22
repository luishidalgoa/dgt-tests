import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { explainQuestion, AIProviderError, type AIExplanationResult } from "@/lib/ai"
import { consumeToken, getQuotaStatus } from "@/lib/aiQuota"

const postSchema = z.object({
  questionId: z.number().int().positive(),
  withImage:  z.boolean().optional().default(false),
  /** Opcional. Si va, el pago se asocia al ExamAttempt indicado. */
  attemptId:  z.number().int().positive().nullable().optional(),
})

const getSchema = z.object({
  questionId: z.coerce.number().int().positive(),
  withImage:  z.union([z.literal("true"), z.literal("false")]).optional().default("false"),
  /** Opcional. Mismo significado que en POST. */
  attemptId:  z.coerce.number().int().positive().optional(),
})

/**
 * Busca un UserAiPaid en el scope correcto:
 *   - attemptId !== null → match exacto sobre (user, attempt, question, withImage)
 *   - attemptId === null → match sobre (user, question, withImage) donde attemptId IS NULL
 *
 * Devolvemos el findFirst para no depender de un @@unique compuesto (que
 * no podemos declarar en Prisma al ser nullable).
 */
async function findPaid(args: {
  userId:     number
  questionId: number
  withImage:  boolean
  attemptId:  number | null
}) {
  return db.userAiPaid.findFirst({
    where: {
      userId:     args.userId,
      questionId: args.questionId,
      withImage:  args.withImage,
      attemptId:  args.attemptId,
    },
  })
}

/**
 * GET /api/ai/explain?questionId=X[&withImage=true|false]
 *
 * Devuelve la explicación ya pagada por este user sin cobrar nada.
 *
 * - 200 + { result, alreadyPaid: true }   si el user ya pagó por esta
 *                                          pregunta y la cache existe.
 * - 200 + { alreadyPaid: false }           si no la ha pagado todavía
 *                                          (el front mostrará el CTA
 *                                          "Generar análisis · 1 token").
 *
 * No consume tokens. No llama a Gemini.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Necesitas una cuenta para usar la IA" }, { status: 401 })
  }

  const url = new URL(req.url)
  const aId = url.searchParams.get("attemptId")
  const parsed = getSchema.safeParse({
    questionId: url.searchParams.get("questionId") ?? "",
    withImage:  url.searchParams.get("withImage") ?? "false",
    ...(aId ? { attemptId: aId } : {}),
  })
  if (!parsed.success) {
    return NextResponse.json({ error: "Query inválida" }, { status: 400 })
  }
  const questionId = parsed.data.questionId
  const withImage  = parsed.data.withImage === "true"
  const attemptId  = parsed.data.attemptId ?? null

  const paid = await findPaid({ userId: user.id, questionId, withImage, attemptId })
  if (!paid) {
    return NextResponse.json({ alreadyPaid: false })
  }

  const cached = await db.aICacheEntry.findUnique({
    where: { questionId_withImage: { questionId, withImage } },
  })
  if (!cached) {
    // Raro: el usuario pagó pero la cache se borró. Tratamos como "no pagado"
    // para que pueda regenerar (le cobraremos otra vez, pero al menos no
    // se queda colgado sin respuesta).
    return NextResponse.json({ alreadyPaid: false })
  }
  try {
    const result = JSON.parse(cached.payloadJson) as AIExplanationResult
    return NextResponse.json({ alreadyPaid: true, result, paidAt: paid.paidAt })
  } catch {
    return NextResponse.json({ alreadyPaid: false })
  }
}

/**
 * POST /api/ai/explain
 *
 * Comportamiento (a partir de Fase 77):
 *
 *  - Si el user YA pagó antes por esta (questionId, withImage) → NO se
 *    le cobra otro token, se devuelve la respuesta cacheada o se
 *    regenera vía Gemini si la cache desapareció.
 *  - Si NO había pagado → consumimos 1 token. Si hay cache hit la
 *    devolvemos sin llamar a Gemini; si no, llamamos a Gemini y
 *    cacheamos. Insertamos un row en user_ai_paid para que próximas
 *    visualizaciones del MISMO user sobre esta MISMA pregunta sean
 *    gratis.
 *
 * Si Gemini falla en una request que consumió token, revertimos el
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
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 })
  }
  const { questionId, withImage } = parsed.data
  const attemptId = parsed.data.attemptId ?? null

  // 3. ¿Ya pagó este user por esta explicación en este contexto (attempt)?
  const alreadyPaid = await findPaid({ userId: user.id, questionId, withImage, attemptId })

  // 4. Si NO pagó, consumir 1 token antes de seguir.
  let consumedQuota = alreadyPaid ? await getQuotaStatus(user.id) : await consumeToken(user.id)
  if (!consumedQuota) {
    const quota = await getQuotaStatus(user.id)
    return NextResponse.json(
      { error: "Has agotado tu quota mensual de IA. Se reseteará el día 1 del próximo mes.", quota },
      { status: 429 }
    )
  }

  const chargedNow = !alreadyPaid

  // Helper para revertir el token si algo va mal y lo habíamos consumido
  async function refundToken() {
    if (!chargedNow) return
    try {
      await db.user.update({
        where: { id: user!.id },
        data:  { aiTokensUsed: { decrement: 1 } },
      })
    } catch {
      // si no podemos revertir, lo dejamos así
    }
  }

  // 5. Cache hit: devolvemos directamente sin llamar a Gemini
  const cached = await db.aICacheEntry.findUnique({
    where: { questionId_withImage: { questionId, withImage } },
  })
  if (cached) {
    try {
      const result = JSON.parse(cached.payloadJson) as AIExplanationResult
      if (chargedNow) {
        await markPaid(user.id, questionId, withImage, attemptId)
        consumedQuota = await getQuotaStatus(user.id)
      }
      return NextResponse.json({ cached: true, result, quota: consumedQuota, charged: chargedNow })
    } catch {
      // JSON corrupto, regeneramos vía Gemini abajo
    }
  }

  // 6. Cargar pregunta con opciones (necesario para llamar a Gemini)
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

  // 7. Llamar a Gemini
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
    // Logueamos el detalle crudo del error en server-side para debug,
    // pero NUNCA lo enviamos al cliente — siempre mapeamos a un mensaje
    // amigable + código que el toast del front puede traducir.
    console.error("[ai/explain] error del provider:", err)

    if (err instanceof AIProviderError) {
      switch (err.kind) {
        case "rate_limit":
          return NextResponse.json(
            {
              error: "La IA no está disponible ahora mismo. Inténtalo en unos minutos.",
              code:  "ai_unavailable",
            },
            { status: 503 }
          )
        case "misconfigured":
          return NextResponse.json(
            {
              error: "El servicio de IA está mal configurado. Avisa al administrador.",
              code:  "ai_misconfigured",
            },
            { status: 503 }
          )
        case "bad_request":
          return NextResponse.json(
            {
              error: "La IA no ha podido procesar esta pregunta. Prueba con otra.",
              code:  "ai_bad_request",
            },
            { status: 502 }
          )
        case "server_error":
          return NextResponse.json(
            {
              error: "Error temporal en el modelo de IA. Inténtalo en unos minutos.",
              code:  "ai_server_error",
            },
            { status: 502 }
          )
      }
    }
    // Genérico — error no clasificado (red, JSON inválido, etc.)
    return NextResponse.json(
      { error: "No se pudo generar el análisis. Inténtalo más tarde.", code: "ai_error" },
      { status: 502 }
    )
  }

  // 8. Guardar en cache global (no bloqueamos respuesta si falla)
  try {
    await db.aICacheEntry.upsert({
      where:  { questionId_withImage: { questionId, withImage } },
      update: { payloadJson: JSON.stringify(result) },
      create: { questionId, withImage, payloadJson: JSON.stringify(result) },
    })
  } catch {
    // no bloqueamos
  }

  // 9. Registrar que ESTE user ya pagó por esta pregunta en este contexto
  if (chargedNow) {
    await markPaid(user.id, questionId, withImage, attemptId)
  }

  const quota = await getQuotaStatus(user.id)
  return NextResponse.json({ cached: false, result, quota, charged: chargedNow })
}

async function markPaid(userId: number, questionId: number, withImage: boolean, attemptId: number | null) {
  try {
    // No usamos upsert porque attemptId puede ser NULL y Prisma no
    // expone partial unique indexes. Insertamos a mano comprobando antes.
    const existing = await findPaid({ userId, questionId, withImage, attemptId })
    if (existing) return
    await db.userAiPaid.create({
      data: { userId, questionId, withImage, attemptId },
    })
  } catch {
    // no bloqueamos respuesta si el insert falla (race con otra request, etc.)
  }
}
