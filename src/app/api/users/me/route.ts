import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { getSessionForWrite } from "@/lib/session"

const schema = z.object({
  username:    z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_.-]+$/, {
    message: "Solo letras, números, guion bajo, punto y guion medio",
  }),
  displayName: z.string().trim().min(1).max(80).optional().nullable(),
})

export async function PATCH(req: Request) {
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

  // Si quiere cambiar el username, comprobar unicidad
  if (parsed.data.username !== user.username) {
    const existing = await db.user.findUnique({
      where: { username: parsed.data.username },
    })
    if (existing && existing.id !== user.id) {
      return NextResponse.json(
        { error: "Ese nombre de usuario ya está en uso" },
        { status: 409 }
      )
    }
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      username:    parsed.data.username,
      displayName: parsed.data.displayName ?? parsed.data.username,
    },
  })

  // Refrescar el username en la sesión
  const session = await getSessionForWrite(true)
  session.userId   = updated.id
  session.username = updated.username
  await session.save()

  return NextResponse.json({
    id:          updated.id,
    username:    updated.username,
    displayName: updated.displayName,
  })
}
