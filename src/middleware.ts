import { NextRequest, NextResponse } from "next/server"
import { getIronSession } from "iron-session"
import type { SessionData } from "@/lib/session"

const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/api/auth/login",
  "/api/auth/register",
]

const SESSION_SECRET =
  process.env.SESSION_SECRET ??
  "dev-secret-dev-secret-dev-secret-dev-secret-changeme"

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Rutas siempre permitidas
  if (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/manual") ||
    pathname.startsWith("/party/") ||                // partys públicas (guests)
    pathname.startsWith("/api/parties/") ||          // ditto
    pathname === "/icon.svg" ||
    pathname === "/apple-icon.svg" ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next()
  }

  // Comprobar sesión usando la firma req+res de iron-session
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
