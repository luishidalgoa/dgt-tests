"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Home,
  Swords,
  ChartBar,
  History,
  MoreHorizontal,
  BookMarked,
  Lightbulb,
  X,
} from "lucide-react"

interface BottomTabsProps {
  /** Cuando no hay user logueado o estamos en /login /register no se muestra. */
  visible: boolean
  /** Para decidir si añadimos el tab "Más" con Por temas + Test de errores. */
  hasFullAccess: boolean
}

/**
 * Bottom navigation tabs — sólo visible en mobile (`<sm`).
 *
 * En mobile la barra de navegación superior se queda con logo + avatar y
 * los links de la app se trasladan a una barra inferior fija (estilo
 * Instagram / X / Notion mobile). En desktop esta barra está oculta
 * con `sm:hidden` y los links siguen viéndose en el navbar superior.
 *
 * Los 4 tabs principales siempre visibles:
 *   Inicio · Competir · Stats · Historial
 *
 * Si el user es PRO/ADMIN aparece además un 5º tab "Más" que abre un
 * drawer inferior con los links de pago (Por temas, Test de errores).
 *
 * El padding-bottom del layout root garantiza que el contenido nunca
 * queda tapado por la barra (ver app/layout.tsx).
 */

const MAIN_TABS = [
  { href: "/",          label: "Inicio",    Icon: Home },
  { href: "/competir",  label: "Competir",  Icon: Swords },
  { href: "/stats",     label: "Stats",     Icon: ChartBar },
  { href: "/historial", label: "Historial", Icon: History },
] as const

const MORE_LINKS = [
  { href: "/temas",         label: "Por temas",       Icon: BookMarked, accent: "orange" as const },
  { href: "/test-errores",  label: "Test de errores", Icon: Lightbulb,  accent: "red"    as const },
] as const

export function BottomTabs({ visible, hasFullAccess }: BottomTabsProps) {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)

  if (!visible) return null

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href)

  // Aplica si la ruta actual cae en cualquiera de los "Más"
  const moreActive = hasFullAccess && MORE_LINKS.some((l) => isActive(l.href))

  return (
    <>
      <nav
        className="bottom-tabs"
        aria-label="Navegación principal"
      >
        {MAIN_TABS.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className={`bottom-tab ${isActive(href) ? "bottom-tab--active" : ""}`}
          >
            <Icon className="bottom-tab__icon" aria-hidden="true" />
            <span className="bottom-tab__label">{label}</span>
          </Link>
        ))}
        {hasFullAccess && (
          <button
            type="button"
            className={`bottom-tab ${moreActive || moreOpen ? "bottom-tab--active" : ""}`}
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
          >
            <MoreHorizontal className="bottom-tab__icon" aria-hidden="true" />
            <span className="bottom-tab__label">Más</span>
          </button>
        )}
      </nav>

      {/* Drawer inferior "Más" — sólo cuando hay items PRO/ADMIN.
          Sin usar Dialog de radix para tener control fino del slide-up
          (radix Dialog centra por defecto). Backdrop manual. */}
      {moreOpen && hasFullAccess && (
        <>
          <div
            className="bottom-more__backdrop"
            onClick={() => setMoreOpen(false)}
            aria-hidden="true"
          />
          <div
            className="bottom-more"
            role="dialog"
            aria-modal="true"
            aria-label="Más opciones"
          >
            <div className="bottom-more__header">
              <span>Más opciones</span>
              <button
                type="button"
                className="bottom-more__close"
                onClick={() => setMoreOpen(false)}
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="bottom-more__list">
              {MORE_LINKS.map(({ href, label, Icon, accent }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMoreOpen(false)}
                  className={`bottom-more__item bottom-more__item--${accent} ${isActive(href) ? "bottom-more__item--active" : ""}`}
                >
                  <Icon className="h-5 w-5" />
                  <span>{label}</span>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  )
}
