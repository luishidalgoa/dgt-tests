import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { getCurrentUser, normalizeUsername, normalizeEmail } from "@/lib/auth"
import { getSessionForWrite } from "@/lib/session"

const schema = z.object({
  username:    z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_.-]+$/, {
    message: "Solo letras, números, guion bajo, punto y guion medio",
  }),
  displayName: z.string().trim().min(1).max(80).optional().nullable(),
  // Email opcional. Si se manda string vacío, lo tratamos como "borrar email".
  email:       z.union([z.string().trim().email("Email no válido"), z.literal("")])
                 .optional()
                 .nullable(),
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

  // ── Username: normalizar a minúsculas + comprobar unicidad si cambia ──
  const normalizedUsername = normalizeUsername(parsed.data.username)
  if (normalizedUsername !== user.username) {
    const existing = await db.user.findUnique({
      where: { username: normalizedUsername },
    })
    if (existing && existing.id !== user.id) {
      return NextResponse.json(
        { error: "Ese nombre de usuario ya está en uso" },
        { status: 409 }
      )
    }
  }

  // ── Email: normalizar (lowercase + trim) y comprobar unicidad si cambia ──
  // Si llega "" o null, lo guardamos como null (borrar).
  const normalizedEmail = parsed.data.email
    ? normalizeEmail(parsed.data.email) || null
    : null

  if (normalizedEmail && normalizedEmail !== user.email) {
    const existing = await db.user.findUnique({
      where: { email: normalizedEmail },
    })
    if (existing && existing.id !== user.id) {
      return NextResponse.json(
        { error: "Ese email ya está asociado a otra cuenta" },
        { status: 409 }
      )
    }
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      username:    normalizedUsername,
      displayName: parsed.data.displayName ?? normalizedUsername,
      // Solo tocamos el email si vino en el payload (undefined = no tocar)
      ...(parsed.data.email !== undefined ? { email: normalizedEmail } : {}),
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
    email:       updated.email,
  })
}
