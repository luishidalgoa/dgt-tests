import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/adminGuard"
import { pingProvider } from "@/lib/ai"

/**
 * POST /api/admin/test-ai-connection
 *
 * Health check de un proveedor de IA concreto. Hace una llamada minimal
 * ("responde: ok", ~5-10 tokens) para verificar que:
 *   - La API key del provider está configurada y es válida
 *   - El modelo elegido existe y responde
 *   - La latencia es razonable (la incluimos en la respuesta para que el
 *     admin tenga una métrica útil)
 *
 * Body: { provider: "gemini" | "groq" }
 * Devuelve 200 siempre — el éxito o fallo del ping va en el body:
 *   { ok: true,  latencyMs, model }
 *   { ok: false, error }
 *
 * Restricción: solo admin (requireAdmin via notFound 404 si no lo es).
 */

const bodySchema = z.object({
  provider: z.enum(["gemini", "groq"]),
})

export async function POST(req: Request) {
  await requireAdmin()

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 })
  }

  const result = await pingProvider(parsed.data.provider)
  return NextResponse.json(result)
}
