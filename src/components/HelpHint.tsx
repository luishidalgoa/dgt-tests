"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
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

/** Alineamientos del popover, decididos dinámicamente según el espacio
 *  disponible alrededor del trigger. */
type HorizontalAlign = "left" | "center" | "right"
type VerticalAlign = "top" | "bottom"

/** Margen mínimo entre el popover y el borde de la viewport, px. */
const VIEWPORT_MARGIN = 12

/**
 * Botoncito de ayuda contextual con un icono "?" que abre un popover
 * con el texto explicativo. Diseñado para clarificar términos de UI
 * sin saturar el layout.
 *
 *   - Desktop: hover muestra tooltip nativo (`title`) y click abre
 *     el popover.
 *   - Mobile: tap abre el popover. Click-outside o Escape lo cierra.
 *   - Auto-flip: tras abrirse, medimos el popover y decidimos si
 *     alinear left/center/right y mostrar arriba/abajo según el
 *     espacio que tenga en la viewport. Nunca se sale por el borde.
 *
 * Es un Client Component porque necesita state local. El padre puede
 * ser un Server Component y embebrlo sin problema.
 */
export function HelpHint({ text, ariaLabel, size = 14 }: Props) {
  const [open, setOpen] = useState(false)
  const [hAlign, setHAlign] = useState<HorizontalAlign>("center")
  const [vAlign, setVAlign] = useState<VerticalAlign>("bottom")
  const wrapperRef  = useRef<HTMLSpanElement>(null)
  const triggerRef  = useRef<HTMLButtonElement>(null)
  const popoverRef  = useRef<HTMLSpanElement>(null)

  // Click fuera + Escape → cerrar.
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

  // Auto-flip: medir el popover y decidir alineamiento que no se salga
  // de la viewport. useLayoutEffect porque queremos la medición antes
  // de que el navegador pinte (evita un "flash" de posición incorrecta).
  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const popover = popoverRef.current
    if (!trigger || !popover) return

    const tr = trigger.getBoundingClientRect()
    const pr = popover.getBoundingClientRect()

    // ── Horizontal ──────────────────────────────────────────────
    // Por defecto el popover está centrado bajo el trigger.
    // Mide el ancho a cada lado del centro del trigger y verifica si
    // el popover se sale por algún borde con el margin de seguridad.
    const triggerCenterX = tr.left + tr.width / 2
    const halfPopover    = pr.width / 2
    const overflowsRight = triggerCenterX + halfPopover > window.innerWidth - VIEWPORT_MARGIN
    const overflowsLeft  = triggerCenterX - halfPopover < VIEWPORT_MARGIN

    let h: HorizontalAlign = "center"
    if (overflowsRight && !overflowsLeft) h = "right" // alinear borde derecho
    else if (overflowsLeft && !overflowsRight) h = "left"
    else if (overflowsRight && overflowsLeft) h = "left" // viewport súper estrecho — alinear izquierda y aceptar truncamiento del max-width CSS

    // ── Vertical ────────────────────────────────────────────────
    // Por defecto abre hacia abajo. Si no cabe, abre hacia arriba.
    const spaceBelow = window.innerHeight - tr.bottom - VIEWPORT_MARGIN
    const v: VerticalAlign = pr.height > spaceBelow ? "top" : "bottom"

     
    setHAlign(h)
     
    setVAlign(v)
  }, [open])

  return (
    <span ref={wrapperRef} className="help-hint">
      <button
        ref={triggerRef}
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
          ref={popoverRef}
          className={`help-hint__popover help-hint__popover--h-${hAlign} help-hint__popover--v-${vAlign}`}
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
        >
          {text}
        </span>
      )}
    </span>
  )
}
