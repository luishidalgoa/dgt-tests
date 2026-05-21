import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticate } from "@/lib/auth"
import { getSessionForWrite } from "@/lib/session"

const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  remember: z.boolean().optional(),
})

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
  }

  const user = await authenticate(parsed.data.username, parsed.data.password)
  if (!user) {
    return NextResponse.json({ error: "Usuario o contraseña incorrectos" }, { status: 401 })
  }

  const remember = parsed.data.remember ?? false
  const session = await getSessionForWrite(remember)
  session.userId = user.id
  session.username = user.username
  await session.save()

  return NextResponse.json({
    id:          user.id,
    username:    user.username,
    displayName: user.displayName,
  })
}
