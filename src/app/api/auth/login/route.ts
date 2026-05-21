import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticate } from "@/lib/auth"
import { getSessionForWrite } from "@/lib/session"

// `identifier` puede ser username o email. Aceptamos también el campo
// legacy `username` por compatibilidad con clientes que no se hayan
// actualizado todavía.
const schema = z.object({
  identifier: z.string().min(1).optional(),
  username:   z.string().min(1).optional(),
  password:   z.string().min(1),
  remember:   z.boolean().optional(),
}).refine((d) => Boolean(d.identifier ?? d.username), {
  message: "Falta el identificador (usuario o email)",
  path:    ["identifier"],
})

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
  }

  const identifier = parsed.data.identifier ?? parsed.data.username ?? ""
  const user = await authenticate(identifier, parsed.data.password)
  if (!user) {
    return NextResponse.json(
      { error: "Usuario/email o contraseña incorrectos" },
      { status: 401 }
    )
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
    email:       user.email,
  })
}
