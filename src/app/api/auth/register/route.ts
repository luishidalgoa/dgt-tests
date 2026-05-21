import { NextResponse } from "next/server"
import { z } from "zod"
import { createUser } from "@/lib/auth"
import { getSessionForWrite } from "@/lib/session"

const schema = z.object({
  username:    z.string().min(3).max(40),
  password:    z.string().min(6).max(120),
  displayName: z.string().max(80).optional(),
})

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const user = await createUser(parsed.data.username, parsed.data.password, parsed.data.displayName)

    // Auto-login tras registro, con sesión persistente por defecto
    const session = await getSessionForWrite(true)
    session.userId   = user.id
    session.username = user.username
    await session.save()

    return NextResponse.json({
      id:          user.id,
      username:    user.username,
      displayName: user.displayName,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido"
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
