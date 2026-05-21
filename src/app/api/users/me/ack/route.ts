import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { addAcknowledgment, NOTIFICATIONS } from "@/lib/notifications"

const validIds = NOTIFICATIONS.map((n) => n.id) as [string, ...string[]]

const schema = z.object({
  key: z.string().min(1).refine((k) => validIds.includes(k), {
    message: "id de notificación desconocido",
  }),
})

/**
 * POST /api/users/me/ack { key }
 *
 * Marca la notificación con id `key` como vista por este usuario. Se llama
 * cuando el modal se cierra (botón "OK", "Continuar gratis", etc.).
 */
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Payload inválido" },
      { status: 400 }
    )
  }

  const next = addAcknowledgment(user.acknowledgments, parsed.data.key)
  await db.user.update({
    where: { id: user.id },
    data:  { acknowledgments: next },
  })

  return NextResponse.json({ ok: true })
}
