"use client"

import { useEffect, useRef, useState } from "react"
import { HelpCircle } from "lucide-react"

interface Props {
  /** Texto explicativo. Aparece como tooltip en desktop (hover) y
   *  como popover en mobile (tap). */
  text: string
  /** Etiqueta accesible más corta para lectores de pantalla. Si no
   *  se pasa, usa `text`. */
  ariaLabel?: string
  /** Tamaño del icono en px. Default 14. */
  size?: number
}

/**
 * Botoncito de ayuda contextual con un icono "?" que abre un popover
 * con el texto explicativo. Diseñado para clarificar términos de UI
 * sin saturar el layout.
 *
 *   - Desktop: hover muestra tooltip nativo (atributo `title`) + el
 *     popover se abre al hacer click.
 *   - Mobile: tap abre el popover. Click-outside lo cierra.
 *
 * Es un Client Component porque necesita state local. El padre puede
 * ser un Server Component y embebrlo sin problema.
 */
export function HelpHint({ text, ariaLabel, size = 14 }: Props) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLSpanElement>(null)

  // Click fuera → cerrar.
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("click", onDocClick)
    document.addEventListener("keydown", onEsc)
    return () => {
      document.removeEventListener("click", onDocClick)
      document.removeEventListener("keydown", onEsc)
    }
  }, [open])

  return (
    <span ref={wrapperRef} className="help-hint">
      <button
        type="button"
        className="help-hint__trigger"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        title={text}
        aria-label={ariaLabel ?? text}
        aria-expanded={open}
      >
        <HelpCircle width={size} height={size} aria-hidden="true" />
      </button>
      {open && (
        <span
          className="help-hint__popover"
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
        >
          {text}
        </span>
      )}
    </span>
  )
}
