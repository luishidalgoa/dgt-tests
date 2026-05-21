import { NextRequest, NextResponse } from "next/server"
import { getIronSession } from "iron-session"
import type { SessionData } from "@/lib/session"

/**
 * Rutas que SIEMPRE requieren autenticación.
 * El resto se permite (incluyendo guests en modo limitado).
 */
const PROTECTED_PREFIXES = [
  "/historial",
  "/stats",
  "/test-errores",
  "/settings",
  "/competir",                       // listado + creación de partys requieren login
  "/api/attempts",
  "/api/users/",
  // Nota: /api/parties/* es público (guests pueden unirse a partys),
  //       el endpoint POST de crear party valida internamente con requireUser
]

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) =>
    pathname === prefix || pathname.startsWith(prefix + "/")
  )
}

const SESSION_SECRET =
  process.env.SESSION_SECRET ??
  "dev-secret-dev-secret-dev-secret-dev-secret-changeme"

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Si la ruta no es protegida, dejar pasar a guests
  if (!isProtected(pathname)) {
    return NextResponse.next()
  }

  // Comprobar sesión
  const res = NextResponse.next()
  const session = await getIronSession<SessionData>(req, res, {
    password:   SESSION_SECRET,
    cookieName: "dgt_tests_session",
  })

  if (!session.userId) {
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("redirect", pathname + req.nextUrl.search)
    return NextResponse.redirect(loginUrl)
  }

  return res
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
