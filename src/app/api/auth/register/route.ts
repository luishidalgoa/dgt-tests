import { NextResponse } from "next/server"
import { z } from "zod"
import { createUser } from "@/lib/auth"
import { getSessionForWrite } from "@/lib/session"

const schema = z.object({
  username:    z.string().min(3).max(40),
  email:       z.string().trim().toLowerCase().email("Email no válido"),
  password:    z.string().min(6).max(120),
  displayName: z.string().max(80).optional(),
  /**
   * RGPD + LSSI (EU): el usuario tiene que dar consentimiento explícito
   * a los términos y política antes del registro. El front lo valida
   * con un checkbox required; aquí lo validamos defensivamente por si
   * alguien hace POST directo al endpoint saltándoselo.
   */
  acceptTerms: z.literal(true, {
    message: "Tienes que aceptar los términos y la política de privacidad",
  }),
})

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message ?? "Datos inválidos"
    return NextResponse.json({ error: firstIssue, issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const user = await createUser({
      username:    parsed.data.username,
      email:       parsed.data.email,
      password:    parsed.data.password,
      displayName: parsed.data.displayName,
    })

    // Auto-login tras registro, con sesión persistente por defecto
    const session = await getSessionForWrite(true)
    session.userId   = user.id
    session.username = user.username
    await session.save()

    return NextResponse.json({
      id:          user.id,
      username:    user.username,
      displayName: user.displayName,
      email:       user.email,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido"
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
