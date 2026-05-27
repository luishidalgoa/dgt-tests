"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { X, Check, Trash2, Loader2, Info, MoreHorizontal } from "lucide-react"
import type { ClassificationTag } from "./lib"

/**
 * Popover "ver todos los tags" para una card del banco. Se abre desde
 * el chip "+N" cuando hay más de 4 tags y la card no puede mostrarlos
 * todos. Renderizado vía portal al body para escapar el overflow:hidden
 * del tile y el transform del SwipeableImageTile.
 *
 * Posicionamiento viewport-aware:
 *   1. Toma el rect del chip que lo abrió (anchorRect).
 *   2. Por defecto se coloca DEBAJO del chip, alineado a la IZQUIERDA.
 *   3. Si se sale por abajo → se voltea ARRIBA del chip.
 *   4. Si se sale por la derecha → se alinea a la DERECHA del chip.
 *   5. Si no cabe en ningún sitio → se centra horizontalmente y se
 *      hace scrollable verticalmente para no salir del viewport.
 *
 * Acciones:
 *   - Si un tag tiene `humanAssigned`, se muestra un botón X que llama
 *     a DELETE /api/admin/images-bank/manual-tag. Tras éxito,
 *     router.refresh() para que la card padre se repinte.
 *   - Click fuera del popover o tecla ESC → cierra.
 */

const POPOVER_MAX_WIDTH  = 360
const POPOVER_MAX_HEIGHT = 440
const POPOVER_GAP        = 6   // separación visual con el anchor
const VIEWPORT_PADDING   = 8   // margen mínimo al borde del viewport

interface Props {
  anchorRect:     DOMRect | null
  tags:           readonly ClassificationTag[]
  sha:            string
  /** Map plano tagId → displayEs precomputado en el Server Component.
   *  No usamos getDisplay como función porque las funciones no son
   *  serializables a través de la frontera Server→Client en RSC. */
  tagDisplayMap:  Readonly<Record<string, string>>
  onClose:        () => void
}

interface ComputedPosition {
  top:        number
  left:       number
  width:      number
  maxHeight:  number
  /** Para la flechita visual (no implementada por ahora, pero útil
   *  guardar el dato si el día de mañana se quiere añadir caret). */
  placedAbove: boolean
}

export function TagListPopover({ anchorRect, tags, sha, tagDisplayMap, onClose }: Props) {
  const router       = useRouter()
  const popoverRef   = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<ComputedPosition | null>(null)
  // Set local de tags eliminados en esta apertura del popover — para que
  // el popover los oculte sin esperar al router.refresh(). El refresh
  // pasa al cerrar.
  const [removedTags, setRemovedTags] = useState<Set<string>>(new Set())
  const [deletingTag, setDeletingTag] = useState<string | null>(null)
  const [error,        setError]      = useState<string | null>(null)

  // ── Cálculo de posición ──────────────────────────────────────────
  // useLayoutEffect: corremos ANTES de pintar para evitar flicker — el
  // popover empieza con visibility hidden y solo aparece tras tener
  // posición válida.
  useLayoutEffect(() => {
    if (!anchorRect) return
    const vw = window.innerWidth
    const vh = window.innerHeight

    const width  = Math.min(POPOVER_MAX_WIDTH,  vw - VIEWPORT_PADDING * 2)
    // height tentativa: estimamos según número de tags. Real maxHeight
    // se aplica abajo para que el cálculo de fitsBelow sea consistente.
    const tentHeight = Math.min(POPOVER_MAX_HEIGHT, Math.max(180, tags.length * 38 + 96))

    // Posición por defecto: debajo, alineado a la izquierda del anchor.
    let top  = anchorRect.bottom + POPOVER_GAP
    let left = anchorRect.left

    // Flip vertical: si no cabe por abajo, va arriba.
    const fitsBelow = top + tentHeight + VIEWPORT_PADDING <= vh
    const fitsAbove = anchorRect.top - POPOVER_GAP - tentHeight >= VIEWPORT_PADDING
    const placedAbove = !fitsBelow && fitsAbove
    if (placedAbove) {
      top = anchorRect.top - POPOVER_GAP - tentHeight
    } else if (!fitsBelow) {
      // No cabe ni arriba ni abajo → lo dejamos abajo pero comprimimos
      // maxHeight para que entre con scroll interno.
      top = Math.max(VIEWPORT_PADDING, vh - tentHeight - VIEWPORT_PADDING)
    }

    // Flip horizontal: si se sale por la derecha, alinear a la derecha
    // del anchor (right edge alignment).
    if (left + width + VIEWPORT_PADDING > vw) {
      left = Math.max(VIEWPORT_PADDING, anchorRect.right - width)
    }
    // Si aún no cabe (popover más ancho que el viewport tras padding),
    // se ajusta a la izquierda con padding.
    if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING

    // maxHeight final: lo que reste al viewport desde top hasta el borde
    // inferior, con padding.
    const maxHeight = Math.min(POPOVER_MAX_HEIGHT, vh - top - VIEWPORT_PADDING)

    // Aquí setState DENTRO de un layout effect es deliberado: necesitamos
    // medir el viewport + el DOMRect del anchor (datos que no existen
    // hasta tras el primer paint) y aplicar la posición ANTES de pintar
    // el popover para evitar un flicker visible. Mismo patrón usado en
    // BankUi.tsx para el modal de "ver preguntas".
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPosition({ top, left, width, maxHeight, placedAbove })
  }, [anchorRect, tags.length])

  // ── Cerrar con click fuera + ESC ─────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); handleClose() }
    }
    // Tipo común para mouse + touch — basta con leer e.target.
    function onOutside(e: Event) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        handleClose()
      }
    }
    window.addEventListener("keydown", onKey)
    // setTimeout para que el click que abrió el popover no lo cierre
    // inmediatamente (se ejecuta en el mismo ciclo de event loop).
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", onOutside, true)
      window.addEventListener("touchstart", onOutside, { capture: true, passive: true })
    }, 0)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("mousedown", onOutside, true)
      window.removeEventListener("touchstart", onOutside, true)
      window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleClose() {
    if (removedTags.size > 0) router.refresh()
    onClose()
  }

  async function handleDeleteManualTag(tag: string) {
    if (deletingTag) return
    setDeletingTag(tag)
    setError(null)
    try {
      const res = await fetch("/api/admin/images-bank/manual-tag", {
        method:  "DELETE",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ sha, tag }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`)
        setDeletingTag(null)
        return
      }
      setRemovedTags((prev) => new Set([...prev, tag]))
      setDeletingTag(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setDeletingTag(null)
    }
  }

  if (!anchorRect) return null

  const visibleTags = tags.filter((t) => !removedTags.has(t.tag))

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`Tags de ${sha.slice(0, 8)}`}
      // stopPropagation en gesture events para que el popover NO dispare
      // el swipe del tile padre cuando el admin interactúa.
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position:        "fixed",
        top:             position?.top ?? 0,
        left:            position?.left ?? 0,
        width:           position?.width,
        maxHeight:       position?.maxHeight,
        visibility:      position ? "visible" : "hidden",
        background:      "#fff",
        borderRadius:    10,
        border:          "1px solid var(--slate-200)",
        boxShadow:       "0 14px 38px rgba(15, 23, 42, 0.18), 0 4px 10px rgba(15, 23, 42, 0.06)",
        zIndex:          700,
        display:         "flex",
        flexDirection:   "column",
        overflow:        "hidden",
      }}
    >
      {/* Header */}
      <header style={{
        display:        "flex",
        alignItems:     "center",
        justifyContent: "space-between",
        padding:        "8px 12px",
        borderBottom:   "1px solid var(--slate-100)",
        background:     "var(--slate-50, #f8fafc)",
        flexShrink:     0,
      }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--slate-700)" }}>
          Tags ({visibleTags.length})
        </div>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Cerrar"
          style={{
            border: 0, background: "transparent", padding: 4,
            cursor: "pointer", color: "var(--slate-500)",
            borderRadius: 6, display: "inline-flex",
          }}
        >
          <X size={14} />
        </button>
      </header>

      {/* Body: lista de tags */}
      <div style={{ overflowY: "auto", flex: 1, padding: 6 }}>
        {visibleTags.length === 0 && (
          <p style={{ padding: 16, margin: 0, fontSize: 12, color: "var(--slate-500)", textAlign: "center" }}>
            Sin tags.
          </p>
        )}
        {visibleTags.map((t) => (
          <PopoverTagRow
            key={t.tag}
            t={t}
            displayEs={tagDisplayMap[t.tag] ?? t.tag}
            isDeleting={deletingTag === t.tag}
            onDeleteManual={t.humanAssigned ? () => handleDeleteManualTag(t.tag) : undefined}
          />
        ))}
        {error && (
          <div style={{
            margin: "8px 6px 0",
            padding: 8,
            background: "rgba(239, 68, 68, 0.08)",
            color: "var(--red-700, #b91c1c)",
            fontSize: 11.5,
            borderRadius: 6,
          }}>
            Error: {error}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Una fila por tag dentro del popover ───────────────────────────────
function PopoverTagRow({
  t,
  displayEs,
  isDeleting,
  onDeleteManual,
}: {
  t:              ClassificationTag
  displayEs:      string
  isDeleting:     boolean
  /** Solo se pasa para tags manuales (humanAssigned). Si undefined,
   *  no se renderiza el botón X. */
  onDeleteManual?: () => void
}) {
  return (
    <div style={{
      display:       "flex",
      alignItems:    "flex-start",
      gap:           8,
      padding:       "7px 8px",
      borderRadius:  6,
      borderLeft:    t.humanAssigned
                       ? "3px solid var(--indigo-500, #6366f1)"
                       : t.humanConfirmed
                         ? "3px solid var(--green, #16a34a)"
                         : "3px solid transparent",
      background:    t.humanAssigned
                       ? "rgba(99, 102, 241, 0.06)"
                       : "transparent",
      marginBottom:  2,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 12.5, color: "var(--slate-900)" }}>{displayEs}</strong>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--slate-400)" }}>
            {t.tag}
          </span>
          {t.humanAssigned && (
            <span style={{
              fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 4,
              background: "var(--indigo-600, #6366f1)", color: "white",
              letterSpacing: "0.05em",
            }}>
              MANUAL
            </span>
          )}
          {t.humanConfirmed && !t.humanAssigned && (
            <span style={{
              fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 4,
              background: "var(--green, #16a34a)", color: "white",
              letterSpacing: "0.05em", display: "inline-flex", alignItems: "center", gap: 2,
            }}>
              <Check size={8} />REVISADO
            </span>
          )}
        </div>
        <div style={{ marginTop: 2, fontSize: 10.5, color: "var(--slate-500)", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span>score <span className="font-mono-tabular" style={{ color: "var(--slate-700)" }}>{t.score.toFixed(2)}</span></span>
          {t.confident && <span style={{ color: "var(--green-d)" }}>· confident</span>}
          {t.assignedBy && <span>· por <strong>{t.assignedBy}</strong></span>}
        </div>
        {t.reason && (
          <div style={{
            marginTop:    4,
            padding:      "5px 7px",
            borderRadius: 5,
            background:   "rgba(99, 102, 241, 0.08)",
            color:        "var(--slate-700)",
            fontSize:     11,
            lineHeight:   1.4,
            fontStyle:    "italic",
            display:      "flex",
            gap:          5,
            alignItems:   "flex-start",
          }}>
            <Info size={11} style={{ flexShrink: 0, marginTop: 2, color: "var(--indigo-600, #6366f1)" }} />
            <span>“{t.reason}”</span>
          </div>
        )}
      </div>
      {onDeleteManual && (
        <button
          type="button"
          onClick={onDeleteManual}
          disabled={isDeleting}
          aria-label={`Eliminar tag manual ${t.tag}`}
          title="Eliminar este tag manual"
          style={{
            border:        0,
            background:    "transparent",
            color:         "var(--red-500, #ef4444)",
            cursor:        isDeleting ? "default" : "pointer",
            padding:       4,
            borderRadius:  4,
            display:       "inline-flex",
            alignItems:    "center",
            justifyContent: "center",
            flexShrink:    0,
            opacity:       isDeleting ? 0.5 : 1,
          }}
        >
          {isDeleting ? <Loader2 size={12} className="spin" /> : <Trash2 size={12} />}
        </button>
      )}
    </div>
  )
}

// ── Chip "+N" que abre el popover ─────────────────────────────────────
/**
 * Componente cliente que envuelve el chip "+N más" en la card.
 *
 * Recibe la lista COMPLETA de tags (incluidos los visibles en la card)
 * para que el popover muestre todo. El visible-count solo afecta al
 * texto del chip.
 *
 * Mismo patrón anti-swipe que la lupa: stopPropagation en gesture
 * events, portal al body para el popover.
 */
export function TagOverflowChip({
  sha,
  hiddenCount,
  allTags,
  tagDisplayMap,
}: {
  sha:            string
  hiddenCount:    number
  allTags:        readonly ClassificationTag[]
  /** Map serializable tagId → displayEs precomputado en el Server. */
  tagDisplayMap:  Readonly<Record<string, string>>
}) {
  const buttonRef    = useRef<HTMLButtonElement | null>(null)
  const [mounted, setMounted] = useState(false)
  const [open,    setOpen]    = useState(false)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true) }, [])

  function handleOpen(e: React.MouseEvent | React.PointerEvent) {
    e.stopPropagation()
    e.preventDefault()
    if (buttonRef.current) {
      setAnchorRect(buttonRef.current.getBoundingClientRect())
    }
    setOpen(true)
  }

  // Si la ventana cambia tamaño mientras el popover está abierto,
  // recalculamos el anchor para que se reposicione.
  useEffect(() => {
    if (!open || !buttonRef.current) return
    function onResize() {
      if (buttonRef.current) setAnchorRect(buttonRef.current.getBoundingClientRect())
    }
    window.addEventListener("resize", onResize)
    window.addEventListener("scroll", onResize, { passive: true, capture: true })
    return () => {
      window.removeEventListener("resize", onResize)
      window.removeEventListener("scroll", onResize, true)
    }
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleOpen}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        title={`Ver los ${hiddenCount} tag${hiddenCount === 1 ? "" : "s"} restante${hiddenCount === 1 ? "" : "s"}`}
        aria-label={`Ver los ${hiddenCount} tags restantes`}
        style={{
          display:        "inline-flex",
          alignItems:     "center",
          justifyContent: "center",
          gap:            4,
          fontSize:       10,
          padding:        "1px 6px",
          borderRadius:   3,
          border:         0,
          background:     "var(--slate-100)",
          color:          "var(--slate-600)",
          cursor:         "pointer",
          fontWeight:     700,
          touchAction:    "none",
        }}
      >
        <MoreHorizontal size={9} />
        +{hiddenCount}
      </button>
      {open && mounted && createPortal(
        <TagListPopover
          anchorRect={anchorRect}
          tags={allTags}
          sha={sha}
          tagDisplayMap={tagDisplayMap}
          onClose={() => setOpen(false)}
        />,
        document.body,
      )}
    </>
  )
}
