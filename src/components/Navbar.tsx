"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { HeaderUser } from "@/components/HeaderUser"

interface NavbarProps {
  user: { username: string; displayName: string | null } | null
  aiTokensRemaining?: number
  aiTokensMax?:       number
}

const LINKS = [
  { href: "/",             label: "Inicio"     },
  { href: "/temas",        label: "Por temas"  },
  { href: "/competir",     label: "Competir"   },
  { href: "/stats",        label: "Stats"      },
  { href: "/historial",    label: "Historial"  },
] as const

const HIDDEN_ROUTES = ["/login", "/register"]

export function Navbar({ user, aiTokensRemaining, aiTokensMax }: NavbarProps) {
  const pathname = usePathname()

  // En pantallas de auth no se muestra el navbar (la pantalla es full-bleed)
  if (HIDDEN_ROUTES.includes(pathname)) return null

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href)

  return (
    <div className="nav-wrap">
      <nav className="nav">
        <Link href="/" className="logo">
          <span className="ring" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9"/>
              <circle cx="12" cy="12" r="2.2"/>
              <path d="M12 5v5M5 13l5 -1M19 13l-5 -1"/>
            </svg>
          </span>
          DGT Tests
        </Link>

        {user && (
          <div className="links">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={isActive(l.href) ? "active" : ""}
              >
                {l.label}
              </Link>
            ))}
            <Link
              href="/test-errores"
              className={`danger ${isActive("/test-errores") ? "active" : ""}`}
            >
              Test de errores
            </Link>
          </div>
        )}

        <div className="nav-right">
          {user ? (
            <HeaderUser
              username={user.displayName ?? user.username}
              aiTokensRemaining={aiTokensRemaining}
              aiTokensMax={aiTokensMax}
            />
          ) : (
            <Link href="/login" className="pill-ghost">
              Iniciar sesión
            </Link>
          )}
        </div>
      </nav>
    </div>
  )
}
