import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"

/**
 * POST /api/users/me/seen-welcome
 *
 * Marca el modal de bienvenida como visto. Se llama al cerrarlo o al
 * elegir un plan, para que no vuelva a aparecer.
 */
export async function POST() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  await db.user.update({
    where: { id: user.id },
    data:  { hasSeenWelcome: true },
  })

  return NextResponse.json({ ok: true })
}
