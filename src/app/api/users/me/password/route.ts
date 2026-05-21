import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { hashPassword, verifyPassword } from "@/lib/auth"

const schema = z.object({
  currentPassword: z.string().min(1, "Introduce tu contraseña actual"),
  newPassword:     z.string().min(6, "La nueva contraseña debe tener al menos 6 caracteres").max(128),
})

/**
 * POST /api/users/me/password
 *
 * Cambia la contraseña del usuario logueado.
 * - Pide la contraseña actual (defensa contra hijacking de sesión).
 * - Hashea la nueva con bcrypt antes de guardar.
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
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 }
    )
  }

  // 1. Comprobar contraseña actual
  const ok = await verifyPassword(parsed.data.currentPassword, user.passwordHash)
  if (!ok) {
    return NextResponse.json(
      { error: "La contraseña actual no es correcta" },
      { status: 403 }
    )
  }

  // 2. Hash + update
  const newHash = await hashPassword(parsed.data.newPassword)
  await db.user.update({
    where: { id: user.id },
    data:  { passwordHash: newHash },
  })

  return NextResponse.json({ ok: true })
}
