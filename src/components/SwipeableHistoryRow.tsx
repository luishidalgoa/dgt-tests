"use client"

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react"

interface Props {
  /** Contenido principal del row (típicamente un <Link>). */
  children: ReactNode
  /** Acción que se revela tras deslizar a la izquierda en mobile. Si no
   *  hay action (p.ej. user no admin), renderiza children sin wrapper. */
  action?:  ReactNode
}

const SWIPE_REVEAL_PX     = 64   // ancho del slot donde aparece la acción
const SWIPE_TRIGGER_RATIO = 0.45 // >45% del width = se revela; menos = snap back
const HORIZONTAL_LOCK_PX  = 8    // mínimo movimiento para decidir dirección

/**
 * Row de Historial con UX adaptativa:
 *
 *  - Mobile (≤640px): swipe-to-reveal estilo iOS. Por defecto el row
 *    se ve full-width sin ninguna acción visible. Deslizar a la izquierda
 *    descubre la papelera. Tap en el contenido revelado vuelve a cerrarlo
 *    sin navegar. Tap fuera de cualquier row revelado también cierra.
 *
 *  - Desktop (>640px): layout clásico — la acción está siempre visible
 *    a la derecha del row, exactamente igual que antes del refactor.
 *
 *  - Sin `action` (user no-admin): renderiza children plano, sin lógica
 *    de gestos ni overhead.
 *
 * No se hace propagación entre rows: si revelas A y revelas B, ambos
 * quedan abiertos. Es UX aceptable y evita coordinación con context.
 */
export function SwipeableHistoryRow({ children, action }: Props) {
  const [isMobile,  setIsMobile]  = useState(false)
  const [dragX,     setDragX]     = useState(0)
  const [revealed,  setRevealed]  = useState(false)
  const [animating, setAnimating] = useState(true)

  const startX    = useRef(0)
  const startY    = useRef(0)
  const direction = useRef<"horizontal" | "vertical" | "unknown">("unknown")

  // Detección de viewport: matchMedia + listener para cambios live.
  // El estado inicial es false (desktop) — en SSR no hay window. Al
  // hidratar, el effect corrige si estamos en mobile.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)")
    const handler = () => setIsMobile(mq.matches)
    handler()
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  // Tap fuera del row → cerrar. Solo activo cuando hay reveal abierto.
  // Sincronizamos dragX+revealed en el mismo handler (no en un effect
  // aparte) para evitar set-state-in-effect.
  useEffect(() => {
    if (!revealed) return
    function handleDocPointer(e: PointerEvent) {
      // Si el target está dentro del row que disparó este effect, no
      // cerramos — eso lo gestiona el onClickCapture interno.
      const target = e.target as HTMLElement | null
      if (target?.closest("[data-swipeable-row]")) return
      setRevealed(false)
      setDragX(0)
    }
    document.addEventListener("pointerdown", handleDocPointer)
    return () => document.removeEventListener("pointerdown", handleDocPointer)
  }, [revealed])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobile) return
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    direction.current = "unknown"
    setAnimating(false)
  }, [isMobile])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isMobile) return
    const dx = e.touches[0].clientX - startX.current
    const dy = e.touches[0].clientY - startY.current

    if (direction.current === "unknown") {
      // No comprometernos a una dirección hasta superar el lock-px,
      // así un tap normal no dispara accidentalmente el swipe.
      if (Math.abs(dx) < HORIZONTAL_LOCK_PX && Math.abs(dy) < HORIZONTAL_LOCK_PX) return
      direction.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical"
    }
    if (direction.current === "vertical") return  // permitir scroll vertical normal

    // Solo permitimos swipe a la IZQUIERDA. Si el row ya estaba revealed,
    // base = -SWIPE_REVEAL_PX y dx positivo lo va cerrando.
    const base = revealed ? -SWIPE_REVEAL_PX : 0
    let next = base + dx
    if (next > 0) next = 0
    if (next < -SWIPE_REVEAL_PX - 20) next = -SWIPE_REVEAL_PX - 20  // pequeño "rubber band"
    setDragX(next)
  }, [isMobile, revealed])

  const handleTouchEnd = useCallback(() => {
    if (!isMobile) return
    if (direction.current !== "horizontal") return
    setAnimating(true)
    const trigger = SWIPE_REVEAL_PX * SWIPE_TRIGGER_RATIO
    const shouldReveal = dragX < -trigger
    setRevealed(shouldReveal)
    setDragX(shouldReveal ? -SWIPE_REVEAL_PX : 0)
    direction.current = "unknown"
  }, [isMobile, dragX])

  // Cuando el row está revealed, un tap en el contenido principal NO debe
  // navegar — solo cerrar la reveal. Cuando no está revealed, el Link
  // funciona como siempre.
  const handleContentClickCapture = useCallback((e: React.MouseEvent) => {
    if (!isMobile) return
    if (revealed) {
      e.preventDefault()
      e.stopPropagation()
      setRevealed(false)
      setDragX(0)
    }
  }, [isMobile, revealed])

  // Sin acción → no merece la pena envolver.
  if (!action) return <>{children}</>

  // Desktop: el patrón flex de toda la vida.
  if (!isMobile) {
    return (
      <div style={{ display: "flex", alignItems: "stretch", gap: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
        <div style={{ display: "flex", alignItems: "center", paddingRight: 6 }}>
          {action}
        </div>
      </div>
    )
  }

  // Mobile: swipe-to-reveal.
  return (
    <div
      data-swipeable-row
      style={{
        position:     "relative",
        overflow:     "hidden",
        borderRadius: 14,
      }}
    >
      {/* Capa de fondo con la acción — se ve cuando el row se desliza */}
      <div
        aria-hidden={!revealed}
        style={{
          position:       "absolute",
          right:          0,
          top:            0,
          bottom:         0,
          width:          SWIPE_REVEAL_PX,
          display:        "flex",
          alignItems:     "center",
          justifyContent: "center",
          background:     "rgba(239, 68, 68, 0.08)",
          pointerEvents:  revealed ? "auto" : "none",
        }}
      >
        {action}
      </div>

      {/* Capa de contenido — se traslada con transform al deslizar */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClickCapture={handleContentClickCapture}
        style={{
          transform:  `translateX(${dragX}px)`,
          transition: animating ? "transform 0.22s ease" : "none",
          background: "#fff",
          position:   "relative",
          willChange: "transform",
        }}
      >
        {children}
      </div>
    </div>
  )
}
