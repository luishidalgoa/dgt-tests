"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { HeaderUser } from "@/components/HeaderUser"

interface NavbarProps {
  user: { username: string; displayName: string | null } | null
  aiTokensRemaining?: number
  aiTokensMax?:       number
  plan?:              "FREE" | "PRO" | "ADMIN"
}

// Links visibles para todos los usuarios logueados
const LINKS_ALL = [
  { href: "/",             label: "Inicio"     },
  { href: "/competir",     label: "Competir"   },
  { href: "/stats",        label: "Stats"      },
  { href: "/historial",    label: "Historial"  },
] as const

// Links solo para PRO/ADMIN — features de pago
const LINKS_PRO = [
  { href: "/temas",        label: "Por temas"  },
] as const

const HIDDEN_ROUTES = ["/login", "/register"]

export function Navbar({ user, aiTokensRemaining, aiTokensMax, plan }: NavbarProps) {
  const pathname = usePathname()

  // En pantallas de auth no se muestra el navbar (la pantalla es full-bleed)
  if (HIDDEN_ROUTES.includes(pathname)) return null

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href)

  return (
    <div className="nav-wrap">
      <nav className="nav">
        <Link href="/" className="logo">
          {/* Logo de marca (mismo PNG que el icon PWA / favicon).
              Tamaño 34px para que coincida visualmente con el ring anterior.
              Sirve la versión 256 — Next/Image se encarga del downscale. */}
          <Image
            src="/icons/icon-256.png"
            alt=""
            width={34}
            height={34}
            priority
            className="logo-img"
            aria-hidden="true"
          />
          DGT Tests
        </Link>

        {user && (
          <div className="links">
            {LINKS_ALL.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={isActive(l.href) ? "active" : ""}
              >
                {l.label}
              </Link>
            ))}
            {/* Links PRO: solo se muestran si tiene acceso completo */}
            {(plan === "PRO" || plan === "ADMIN") && LINKS_PRO.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={isActive(l.href) ? "active" : ""}
              >
                {l.label}
              </Link>
            ))}
            {(plan === "PRO" || plan === "ADMIN") && (
              <Link
                href="/test-errores"
                className={`danger ${isActive("/test-errores") ? "active" : ""}`}
              >
                Test de errores
              </Link>
            )}
          </div>
        )}

        <div className="nav-right">
          {user ? (
            <HeaderUser
              username={user.displayName ?? user.username}
              aiTokensRemaining={aiTokensRemaining}
              aiTokensMax={aiTokensMax}
              plan={plan}
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
