import { getIronSession, type SessionOptions } from "iron-session"
import { cookies } from "next/headers"

/** Datos guardados en la cookie de sesión (encriptados). */
export interface SessionData {
  userId?:   number
  username?: string
}

const SESSION_SECRET =
  process.env.SESSION_SECRET ??
  // Fallback solo para desarrollo (Vercel: define SESSION_SECRET de 32+ chars)
  "dev-secret-dev-secret-dev-secret-dev-secret-changeme"

if (SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET debe tener al menos 32 caracteres")
}

export const sessionOptions: SessionOptions = {
  password:   SESSION_SECRET,
  cookieName: "dgt_tests_session",
  cookieOptions: {
    secure:   process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge:   60 * 60 * 24 * 30,    // 30 días
    path:     "/",
  },
}

/** Devuelve la sesión actual del usuario para usar en Server Components y API routes */
export async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, sessionOptions)
}
