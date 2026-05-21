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

/** Opciones de cookie según el flag "recordarme". */
export function sessionOptionsFor(remember: boolean): SessionOptions {
  return {
    password:   SESSION_SECRET,
    cookieName: "dgt_tests_session",
    cookieOptions: {
      secure:   process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      path:     "/",
      // Si remember=false → no maxAge → cookie de sesión (se borra al cerrar el navegador)
      // Si remember=true  → 60 días persistentes
      ...(remember ? { maxAge: 60 * 60 * 24 * 60 } : {}),
    },
  }
}

/** Opciones por defecto (para LEER la sesión). Las opciones de cookie no se
 *  aplican al leer, solo al escribir. Por defecto usamos la versión persistente. */
export const sessionOptions = sessionOptionsFor(true)

/** Devuelve la sesión actual del usuario para usar en Server Components y API routes */
export async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, sessionOptions)
}

/** Para usar al hacer login con un flag "remember" específico. */
export async function getSessionForWrite(remember: boolean) {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, sessionOptionsFor(remember))
}
