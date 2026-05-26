"use client"

/**
 * Componentes UI compartidos entre /admin/images-bank (page.tsx, server
 * component) y el modal `ImageBankPicker` (client component).
 *
 * Por qué un solo archivo client:
 *   - page.tsx (server) puede renderizar componentes client sin problema;
 *     solo no puede pasarles funciones — por eso los pills aceptan
 *     `href` (string, sirve para server) O `onClick` (función, sirve
 *     para client) según el modo.
 *   - El modal usa onClick (filtros = state local). La página usa href
 *     (filtros = URL params, navegación server-side con <Link>).
 *
 * Si cambias el estilo de un pill o el comportamiento de hover, toca
 * AQUÍ y los dos sitios se actualizan a la vez.
 */

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { ExternalLink, X } from "lucide-react"
import {
  activePillBackground,
  qualityPillStyle,
  sortTogglePillStyle,
  sidebarHeaderStyle,
  type PillColor,
  type EntryQuestionRef,
  type DisplayEntry,
} from "./lib"

// ── FilterPill (genérico — filtro especial o por tag) ──────────────────

interface FilterPillBaseProps {
  label:     string
  count:     number
  /** Sub-count en gris al lado del count principal (típicamente
   *  "confident count" del mismo tag). Se omite si es 0 o undefined. */
  subCount?: number
  active:    boolean
  color?:    PillColor
  icon?:     ReactNode
  /** Si true, renderiza un badge "NEW" verde al lado del label. Pensado
   *  para labels añadidos recientemente (lib `isLabelNew()` decide la
   *  ventana, por defecto 7 días). */
  isNew?:    boolean
}

type FilterPillProps =
  | (FilterPillBaseProps & { href: string;     onClick?: never })
  | (FilterPillBaseProps & { href?: never;     onClick: () => void })

/**
 * Pill de filtro (capsulada con label + count). Polimórfico:
 *   - Si recibe `href` → renderiza `<Link>` (modo page.tsx, navegación
 *     server-side con query params).
 *   - Si recibe `onClick` → renderiza `<button>` (modo picker modal,
 *     filtros locales en useState).
 */
export function FilterPill(props: FilterPillProps) {
  const { label, count, subCount, active, color, icon, isNew } = props
  const baseStyle = pillBaseStyle(active, color)

  const inner = (
    <>
      {icon}
      {label}
      {isNew && (
        <span
          aria-label="Tag nuevo"
          title="Añadido recientemente"
          style={{
            padding:       "0 5px",
            borderRadius:  4,
            fontSize:      8.5,
            fontWeight:    900,
            letterSpacing: "0.04em",
            background:    active ? "rgba(255,255,255,0.85)" : "var(--green-d, #15803d)",
            color:         active ? "var(--green-d, #15803d)" : "#fff",
            lineHeight:    1.4,
          }}
        >
          NEW
        </span>
      )}
      <span
        className="font-mono-tabular"
        style={{
          padding:      "0 6px",
          borderRadius: 8,
          fontSize:     10,
          background:   active ? "rgba(255,255,255,0.25)" : "var(--slate-200)",
          color:        active ? "#fff" : "var(--slate-600)",
        }}
      >
        {count.toLocaleString("es")}
        {subCount !== undefined && subCount > 0 && (
          <span style={{ opacity: 0.7, marginLeft: 3 }}>
            ·{subCount}
          </span>
        )}
      </span>
    </>
  )

  if (props.href) {
    return <Link href={props.href} style={baseStyle}>{inner}</Link>
  }
  return <button type="button" onClick={props.onClick} style={baseStyle}>{inner}</button>
}

/** Style común para FilterPill — ambas variantes (Link y button). */
function pillBaseStyle(active: boolean, color: PillColor): React.CSSProperties {
  return {
    display:        "inline-flex",
    alignItems:     "center",
    gap:            6,
    padding:        "4px 10px",
    borderRadius:   16,
    fontSize:       12,
    fontWeight:     600,
    textDecoration: "none",
    background:     active ? activePillBackground(color) : "var(--slate-100)",
    color:          active ? "#fff" : "var(--slate-700)",
    border:         active ? "0" : "1px solid var(--slate-200)",
    cursor:         "pointer",
    transition:     "background 0.15s",
  }
}

// ── QualityPill ────────────────────────────────────────────────────────

interface QualityPillBaseProps {
  active:    boolean
  /** Color del tier (verde, amarillo, naranja, rojo). Solo se usa en
   *  estado activo — en inactivo el background es gris uniforme. */
  tierColor: string
  /** Label principal (e.g. "Muy alta", "Bajo"). Puede llevar un dot al
   *  lado si se pasa `showDot`. */
  label:     string
  count:     number
  title?:    string
  /** Si true, añade un dot circular del color del tier al lado del
   *  label. Para "Todas" (sin tier asociado) pasarlo como false. */
  showDot?:  boolean
}

type QualityPillProps =
  | (QualityPillBaseProps & { href: string;     onClick?: never })
  | (QualityPillBaseProps & { href?: never;     onClick: () => void })

export function QualityPill(props: QualityPillProps) {
  const { active, tierColor, label, count, title, showDot } = props
  // El pill "Todas" (showDot=false) NO representa un tier — usamos un
  // color neutral oscuro para que en estado activo se vea texto blanco
  // sobre fondo oscuro. Antes pasábamos slate-100 → blanco sobre blanco
  // y no se veía nada.
  const effectiveBg = showDot ? tierColor : "var(--ink)"
  const style = qualityPillStyle(active, effectiveBg)
  const inner = (
    <>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {showDot && (
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: tierColor, flexShrink: 0,
          }} />
        )}
        {label}
      </span>
      <span className="font-mono-tabular" style={{ fontSize: 10, opacity: 0.85 }}>
        {count.toLocaleString("es")}
      </span>
    </>
  )

  if (props.href) {
    return <Link href={props.href} style={style} title={title}>{inner}</Link>
  }
  return <button type="button" onClick={props.onClick} style={style} title={title}>{inner}</button>
}

// ── SortToggle ─────────────────────────────────────────────────────────

interface SortToggleBaseProps {
  active: boolean
  label:  string
  title?: string
}

type SortToggleProps =
  | (SortToggleBaseProps & { href: string;     onClick?: never })
  | (SortToggleBaseProps & { href?: never;     onClick: () => void })

export function SortToggle(props: SortToggleProps) {
  const { active, label, title } = props
  const style = sortTogglePillStyle(active)
  if (props.href) {
    return <Link href={props.href} style={style} title={title}>{label}</Link>
  }
  return <button type="button" onClick={props.onClick} style={style} title={title}>{label}</button>
}

// ── SidebarHeader ──────────────────────────────────────────────────────

export function SidebarHeader({ children }: { children: ReactNode }) {
  return <div style={sidebarHeaderStyle}>{children}</div>
}

// ── ScrollToHashTarget ────────────────────────────────────────────────

/**
 * Cuando la URL contiene un hash tipo `#img-<sha>`, hace scroll suave
 * hasta ese elemento + outline naranja temporal (3s) para destacarlo.
 *
 * Útil para "ir a esta imagen desde un tag": el user clica un pill en
 * una tile → URL pasa a `?tag=X#img-Y` → page.tsx re-renderiza con el
 * nuevo filtro → este componente detecta el hash y centra la tile Y
 * con un destello visual.
 *
 * Espera un pequeño delay para que el grid (con lazy load) esté
 * renderizado antes de scroll. También responde a hashchange por si
 * el user clica varios tags seguidos sin recargar.
 */
export function ScrollToHashTarget() {
  useEffect(() => {
    function go() {
      const hash = window.location.hash
      if (!hash || !hash.startsWith("#img-")) return
      const id = hash.slice(1)
      // Pequeño delay para que el grid esté renderizado tras la
      // navegación (los tiles pueden tardar en aparecer en DOM)
      const t = setTimeout(() => {
        const el = document.getElementById(id)
        if (!el) return
        el.scrollIntoView({ behavior: "smooth", block: "center" })
        // Highlight visual: outline naranja que decae a transparente.
        // Usamos inline style para no necesitar CSS global.
        el.style.transition = "outline 0.25s, outline-offset 0.25s"
        el.style.outline       = "3px solid var(--orange-600, #ea580c)"
        el.style.outlineOffset = "3px"
        setTimeout(() => {
          el.style.outline       = "0 solid transparent"
          el.style.outlineOffset = "0"
          // Limpiar inline styles tras la transición para no
          // contaminar el DOM
          setTimeout(() => {
            el.style.transition    = ""
            el.style.outline       = ""
            el.style.outlineOffset = ""
          }, 300)
        }, 2800)
      }, 200)
      return () => clearTimeout(t)
    }
    // Ejecutar al mount + al cambiar el hash (clicar otro tag sin
    // reload completo)
    go()
    window.addEventListener("hashchange", go)
    return () => window.removeEventListener("hashchange", go)
  }, [])
  return null
}

// ── NewImageBadge ──────────────────────────────────────────────────────

/**
 * Sello "NEW" en la esquina superior izquierda del tile, para imágenes
 * agregadas al banco en los últimos N días (ver `isImageNew()` en lib.ts).
 *
 * Posicionado absolute → el tile padre debe tener position: relative.
 * Esquina izquierda para no chocar con el icono de zoom de
 * LazyTileImage que está en top-right.
 *
 * `pointerEvents: none` para que clicks pasen al tile (selección en
 * picker / zoom en galería).
 */
export function NewImageBadge({ size = "md" }: { size?: "sm" | "md" } = {}) {
  const px = size === "sm" ? { padding: "1px 5px", fontSize: 8.5, top: 4, left: 4 }
                            : { padding: "2px 6px", fontSize: 9.5, top: 6, left: 6 }
  return (
    <span
      aria-label="Imagen agregada recientemente"
      title="Agregada al banco en los últimos 7 días"
      style={{
        position:      "absolute",
        top:           px.top,
        left:          px.left,
        zIndex:        5,
        padding:       px.padding,
        borderRadius:  4,
        background:    "var(--green-d, #15803d)",
        color:         "#fff",
        fontSize:      px.fontSize,
        fontWeight:    900,
        letterSpacing: "0.04em",
        pointerEvents: "none",
        boxShadow:     "0 2px 6px rgba(0,0,0,0.25)",
      }}
    >
      NEW
    </span>
  )
}

// ── QuestionsListButton ────────────────────────────────────────────────

/**
 * Botón pequeño que muestra "N preguntas" como trigger. Al click abre
 * un panel modal flotante con la lista de preguntas que referencian la
 * imagen — cada una linkable al editor `/admin/questions/[id]/edit`.
 *
 * Usado en `ImageTile` (página) y `PickerTile` (modal del picker). En
 * el picker, `stopPropagation` evita que el click dispare el `onSelect`
 * del tile (que seleccionaría la imagen).
 *
 * Si `questions` está vacío renderiza un span gris "sin preguntas"
 * (sin trigger).
 */
export function QuestionsListButton({ questions }: { questions: EntryQuestionRef[] }) {
  const [open, setOpen] = useState(false)
  // mounted: solo renderizamos el portal cuando estamos en cliente
  // (document existe). Patrón estándar para SSR-safe portals — el
  // setState en useEffect es necesario para evitar hydration mismatch.
  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true) }, [])

  // ESC cierra + bloqueo scroll body
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [open])

  const count = questions.length

  if (count === 0) {
    return (
      <span style={{ color: "var(--slate-400)", fontStyle: "italic", fontSize: 10.5 }}>
        sin preguntas
      </span>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        title={`Ver las ${count} ${count === 1 ? "pregunta" : "preguntas"} que usan esta imagen`}
        style={{
          border:         0,
          background:     "transparent",
          padding:        0,
          margin:         0,
          cursor:         "pointer",
          color:          "var(--slate-600)",
          fontSize:       10.5,
          textAlign:      "left",
          font:           "inherit",
          textDecoration: "underline",
          textDecorationStyle: "dotted",
          textDecorationColor: "var(--slate-300)",
          textUnderlineOffset: 2,
        }}
      >
        <b style={{ color: "var(--orange-600)" }}>{count}</b>{" "}
        {count === 1 ? "pregunta" : "preguntas"}
      </button>

      {open && mounted && createPortal(
        <div
          onClick={() => setOpen(false)}
          // stopPropagation en mousedown/touchstart para que el modal
          // (que cuando lo usa un SwipeableImageTile está renderizado
          // FUERA del tile gracias al portal) no inicie drag igualmente
          // si por algún motivo un evento burbujease.
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={`Preguntas que usan esta imagen`}
          style={{
            position:       "fixed",
            inset:          0,
            background:     "rgba(15, 23, 42, 0.55)",
            backdropFilter: "blur(3px)",
            zIndex:         9500,
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            padding:        24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background:    "#fff",
              borderRadius:  12,
              maxWidth:      560,
              width:         "100%",
              maxHeight:     "82vh",
              display:       "flex",
              flexDirection: "column",
              overflow:      "hidden",
              boxShadow:     "0 20px 60px rgba(0,0,0,0.4)",
            }}
          >
            <header style={{
              display:        "flex",
              alignItems:     "center",
              justifyContent: "space-between",
              padding:        "12px 16px",
              borderBottom:   "1px solid var(--slate-200)",
              background:     "var(--slate-50, #f8fafc)",
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 800 }}>
                  {count} {count === 1 ? "pregunta" : "preguntas"}
                </span>
                <span style={{ fontSize: 11.5, color: "var(--slate-500)" }}>
                  usan esta imagen
                </span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                style={{
                  border:       0,
                  background:   "transparent",
                  padding:      6,
                  borderRadius: 6,
                  cursor:       "pointer",
                  color:        "var(--slate-600)",
                  display:      "inline-flex",
                }}
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
              {questions.map((q) => (
                <Link
                  key={q.id}
                  href={`/admin/questions/${q.id}/edit`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display:        "flex",
                    alignItems:     "center",
                    gap:            10,
                    padding:        "8px 10px",
                    borderRadius:   8,
                    border:         "1px solid var(--slate-100)",
                    background:     "#fff",
                    color:          "var(--slate-700)",
                    textDecoration: "none",
                    fontSize:       12.5,
                    marginBottom:   6,
                    transition:     "background 0.12s, border-color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--slate-50, #f8fafc)"
                    e.currentTarget.style.borderColor = "var(--slate-200)"
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#fff"
                    e.currentTarget.style.borderColor = "var(--slate-100)"
                  }}
                >
                  <span
                    className="font-mono-tabular"
                    style={{
                      padding:      "2px 7px",
                      borderRadius: 5,
                      background:   "var(--slate-100)",
                      color:        "var(--orange-600)",
                      fontSize:     11,
                      fontWeight:   800,
                      flexShrink:   0,
                    }}
                  >
                    #{q.id}
                  </span>
                  {q.codigoTema && (
                    <span
                      className="font-mono-tabular"
                      style={{
                        padding:      "2px 7px",
                        borderRadius: 5,
                        background:   "rgba(168, 85, 247, 0.10)",
                        color:        "rgb(126, 34, 206)",
                        fontSize:     10.5,
                        fontWeight:   700,
                        flexShrink:   0,
                      }}
                    >
                      {q.codigoTema}
                    </span>
                  )}
                  <span style={{
                    color:        "var(--slate-400)",
                    fontSize:     11,
                    overflow:     "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace:   "nowrap",
                  }}>
                    externalId: {q.externalId}
                  </span>
                  <ExternalLink
                    className="h-3.5 w-3.5"
                    style={{ marginLeft: "auto", color: "var(--slate-400)", flexShrink: 0 }}
                  />
                </Link>
              ))}
            </div>

            <footer style={{
              padding:      "8px 14px",
              borderTop:    "1px solid var(--slate-100)",
              fontSize:     11,
              color:        "var(--slate-500)",
              background:   "var(--slate-50, #f8fafc)",
              textAlign:    "center",
            }}>
              Click sobre una pregunta para abrir su editor (nueva pestaña). ESC o click fuera para cerrar.
            </footer>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

// ── DateDivider ────────────────────────────────────────────────────────

/**
 * Divisor de fecha que separa secciones del grid cuando el orden está
 * en modo "Más recientes". Visual: línea horizontal con un pill central
 * que muestra el label del bucket ("Hoy", "Esta semana"…) + count.
 *
 * Se usa tanto en /admin/images-bank (page.tsx) como en el modal del
 * picker (ImageBankPicker.tsx) — un solo lugar para tocar si el estilo
 * cambia.
 */
export function DateDivider({ label, sub, count }: {
  label: string
  sub:   string
  count: number
}) {
  return (
    <div style={{
      display:       "flex",
      alignItems:    "center",
      gap:           10,
      margin:        "16px 0 10px",
    }}>
      <div style={{ flex: 1, height: 1, background: "var(--slate-200)" }} />
      <div style={{
        display:        "inline-flex",
        alignItems:     "center",
        gap:            8,
        padding:        "5px 12px",
        borderRadius:   999,
        background:     "var(--slate-100)",
        border:         "1px solid var(--slate-200)",
        fontSize:       12,
        fontWeight:     700,
        color:          "var(--slate-700)",
      }}>
        <span>{label}</span>
        <span style={{ fontSize: 10, fontWeight: 500, color: "var(--slate-500)" }}>
          · {sub}
        </span>
        <span
          className="font-mono-tabular"
          style={{
            padding:      "0 7px",
            borderRadius: 999,
            background:   "var(--ink)",
            color:        "#fff",
            fontSize:     10,
            fontWeight:   800,
          }}
        >
          {count.toLocaleString("es")}
        </span>
      </div>
      <div style={{ flex: 1, height: 1, background: "var(--slate-200)" }} />
    </div>
  )
}

// ── SwipeableImageTile (Tinder swipe over tile) ────────────────────────

/** Distancia (px) que hay que arrastrar antes de que se confirme el
 *  swipe. Por debajo, snap back a 0. */
const SWIPE_THRESHOLD_PX = 100

// Singleton de módulo: máximo una exclusión pendiente de undo a la vez.
// Si el usuario swipea "no es" en un segundo tile antes de que expire la
// ventana del primero, el primero se confirma inmediatamente.
let _activePendingCommit: (() => void) | null = null
function setActivePendingCommit(fn: (() => void) | null) { _activePendingCommit = fn }
function triggerActivePendingCommit() {
  if (_activePendingCommit) { _activePendingCommit(); _activePendingCommit = null }
}

/**
 * Wrapper Tinder-style sobre un tile. Solo úsalo cuando hay un
 * `tagFilter` activo (tiene sentido decir "esta imagen no es de
 * ESE tag" solo si estás filtrando por uno).
 *
 * Comportamiento:
 *   - DRAG izquierda → animación + POST exclusión → tile desaparece
 *   - DRAG derecha → no-op visual (futuro: confirmar/refuerzo positivo)
 *   - Botón "No es" overlay en esquina (alternativa al drag — útil en
 *     desktop sin trackpad gestual)
 *
 * children: TODO el contenido visual del tile (imagen + body). El
 * componente se encarga del wrapper con border + position + drag.
 * Esto evita duplicar la lógica de tile entre el componente normal y
 * el swipeable — el padre pasa el mismo body que usa fuera.
 */
export function SwipeableImageTile({ entry, tag, tagDisplay, anchorId, children }: {
  entry:      DisplayEntry
  tag:        string
  tagDisplay: string
  /** Opcional: id HTML para que ScrollToHashTarget pueda hacer
   *  scrollIntoView. En modo swipe este wrapper es el más exterior
   *  → lleva el id (el ImageTile interno NO, para evitar duplicados). */
  anchorId?:  string
  /** Todo el contenido visual del tile (imagen + body). El componente
   *  añade el wrapper con drag + overlays. */
  children:   ReactNode
}) {
  const router = useRouter()
  const [dragX, setDragX]                 = useState(0)
  const [dragging, setDragging]           = useState(false)
  const [exiting, setExiting]             = useState(false)
  const [removed, setRemoved]             = useState(false)
  const [submitting, setSubmitting]       = useState(false)
  const [confirmed, setConfirmed]         = useState(false)
  const [error, setError]                 = useState<string | null>(null)
  const [undoPending, setUndoPending]     = useState(false)
  const [undoCountdown, setUndoCountdown] = useState(5)
  const [mounted, setMounted]             = useState(false)
  const [collapsed, setCollapsed]         = useState(false)
  const startXRef       = useRef(0)
  const undoTimerRef    = useRef<ReturnType<typeof setTimeout>  | null>(null)
  const undoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isMountedRef    = useRef(true)

  // Tras confirmar ("Sí es"), router.refresh() puede reordenar el grid
  // y la imagen cambia de posición. Esperamos ~500ms para que el
  // re-render del server component termine y luego hacemos scroll
  // suave hasta el elemento (identificado por anchorId o sha).
  useEffect(() => {
    if (!confirmed) return
    const targetId = anchorId ?? `img-${entry.sha}`
    const t = setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "center" })
    }, 500)
    return () => clearTimeout(t)
  // Solo se dispara una vez cuando `confirmed` pasa a true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed])

  // SSR-safe portal gate
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true) }, [])

  // Limpiar timers del undo al desmontar para evitar setState en componente muerto.
  // isMountedRef.current = true aquí para que React Strict Mode (que invoca cleanup
  // antes del segundo mount en dev) no deje el ref en false permanentemente.
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (undoTimerRef.current)    clearTimeout(undoTimerRef.current)
      if (undoIntervalRef.current) clearInterval(undoIntervalRef.current)
    }
  }, [])

  /**
   * Inicia drag SOLO si el target del pointer-down NO es un elemento
   * interactivo. Esto deja libres los clicks sobre:
   *   - botones (Quitar, "X preguntas", "No es", "Sí es")
   *   - links (<a>, Next/<Link> que renderiza <a>)
   *   - cualquier elemento con `data-no-drag` (escape hatch)
   *
   * Si el user clica un tag pill del body, el click navega como
   * Link normal sin disparar drag.
   */
  function handlePointerDown(target: EventTarget | null, clientX: number) {
    if (exiting || submitting || removed) return
    if (target instanceof HTMLElement) {
      if (target.closest("button, a, [data-no-drag]")) return
    }
    setDragging(true)
    startXRef.current = clientX
  }
  function handlePointerMove(clientX: number) {
    if (!dragging) return
    setDragX(clientX - startXRef.current)
  }
  function handlePointerUp() {
    if (!dragging) return
    setDragging(false)
    if (dragX <= -SWIPE_THRESHOLD_PX) {
      submitFeedback("exclude")
    } else if (dragX >= SWIPE_THRESHOLD_PX) {
      submitFeedback("confirm")
    } else {
      setDragX(0)
      // Click (desplazamiento mínimo) → actualizar hash para que al recargar
      // la página se haga scroll hasta esta imagen via ScrollToHashTarget.
      if (Math.abs(dragX) < 8) {
        const id = anchorId ?? `img-${entry.sha}`
        const url = new URL(window.location.href)
        url.hash = id
        history.replaceState(null, "", url.toString())
      }
    }
  }

  function handleUndo() {
    if (undoTimerRef.current)    { clearTimeout(undoTimerRef.current);   undoTimerRef.current = null }
    if (undoIntervalRef.current) { clearInterval(undoIntervalRef.current); undoIntervalRef.current = null }
    setActivePendingCommit(null)  // desregistrar del singleton — undo cancelado
    setUndoPending(false)
    setExiting(false)
    setCollapsed(false)
    setDragX(0)
    setSubmitting(false)
  }

  async function doExcludeAPI() {
    if (!isMountedRef.current) return
    try {
      const res = await fetch("/api/admin/images-bank/tag-exclusion", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ sha: entry.sha, tag }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      if (!isMountedRef.current) return
      setRemoved(true)
      router.refresh()
    } catch (e) {
      if (!isMountedRef.current) return
      setExiting(false)
      setCollapsed(false)
      setDragX(0)
      setError(e instanceof Error ? e.message : String(e))
      setSubmitting(false)
    }
  }

  async function submitFeedback(action: "exclude" | "confirm") {
    if (submitting || exiting) return
    if (action === "confirm" && confirmed) { setDragX(0); return }
    setSubmitting(true)
    setError(null)

    if (action === "exclude") {
      // Si hay otra tile con undo pendiente, confirmarla inmediatamente
      // antes de iniciar este nuevo flujo (máximo una a la vez).
      triggerActivePendingCommit()

      // Optimistic: animar tile fuera y dar 5s para deshacer.
      setDragX(-200)
      setExiting(true)
      setTimeout(() => { if (isMountedRef.current) setCollapsed(true) }, 300)
      setUndoPending(true)
      setUndoCountdown(5)
      setSubmitting(false)
      undoIntervalRef.current = setInterval(() => {
        setUndoCountdown((c) => c - 1)
      }, 1000)

      // Registrar callback de "confirmar ahora" para que otro tile pueda
      // dispararlo si el usuario swipea antes de que expiren los 5s.
      setActivePendingCommit(() => {
        if (undoIntervalRef.current) { clearInterval(undoIntervalRef.current); undoIntervalRef.current = null }
        if (undoTimerRef.current)    { clearTimeout(undoTimerRef.current);     undoTimerRef.current    = null }
        setUndoPending(false)
        void doExcludeAPI()
      })

      undoTimerRef.current = setTimeout(async () => {
        if (undoIntervalRef.current) { clearInterval(undoIntervalRef.current); undoIntervalRef.current = null }
        if (!isMountedRef.current) return
        setActivePendingCommit(null)
        setUndoPending(false)
        await doExcludeAPI()
      }, 5000)
      return
    }

    // Confirm: flash verde → snap back → tile se queda con borde verde
    try {
      const res = await fetch("/api/admin/images-bank/tag-confirmation", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ sha: entry.sha, tag }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      setDragX(200)
      setTimeout(() => {
        setDragX(0)
        setConfirmed(true)
        setSubmitting(false)
        router.refresh()
      }, 380)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSubmitting(false)
      setDragX(0)
    }
  }

  if (removed) return null

  // Cálculos visuales del drag
  const rotation = dragX / 25  // 25px → 1deg, sutil
  const opacity  = exiting
    ? 0
    : Math.max(0.4, 1 - Math.abs(dragX) / 600)
  // Constante grande en vez de window.innerWidth (evita problemas SSR
  // y funciona bien — el tile termina fuera de pantalla en cualquier viewport).
  // Dirección según último dragX (negativo = exit izquierda, positivo = derecha).
  const translateX = exiting ? (dragX < 0 ? -1500 : 1500) : dragX

  const isReject  = dragX < -20
  const isConfirm = dragX > 20

  return (
  <>
    <div
      id={anchorId}
      style={{
        // Wrapper TRANSPARENTE — el border/background lo pone el tile
        // hijo (children). Aquí solo añadimos drag + overlays.
        display:       collapsed ? "none" : undefined,
        position:      "relative",
        transform:     `translateX(${translateX}px) rotate(${rotation}deg)`,
        opacity,
        transition:    dragging ? "none" : "transform 0.3s ease-out, opacity 0.3s ease-out",
        touchAction:   "pan-y", // permite scroll vertical normal
        cursor:        dragging ? "grabbing" : "grab",
        userSelect:    "none",
        borderRadius:  10, // para clipear los overlays a la forma del tile
        overflow:      "hidden",
        height:        "100%", // estira hasta la altura de la fila del grid
        // Borde verde persistente cuando ya se ha confirmado el tag
        outline:       confirmed ? "2px solid #16a34a" : "none",
        outlineOffset: "-2px",
      }}
      onMouseDown={(e) => handlePointerDown(e.target, e.clientX)}
      onMouseMove={(e) => dragging && handlePointerMove(e.clientX)}
      onMouseUp={handlePointerUp}
      onMouseLeave={() => dragging && handlePointerUp()}
      onTouchStart={(e) => handlePointerDown(e.target, e.touches[0].clientX)}
      onTouchMove={(e) => handlePointerMove(e.touches[0].clientX)}
      onTouchEnd={handlePointerUp}
    >
      {/* Contenido del tile pasado por el padre (imagen + body) */}
      <div style={{ pointerEvents: dragging ? "none" : "auto", height: "100%" }}>
        {children}
      </div>

      {/* Overlay de swipe — visible durante el drag o el confirm */}
      {(isReject || isConfirm) && (
        <div
          style={{
            position:       "absolute",
            inset:          0,
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            background:     isReject
              ? "rgba(239, 68, 68, 0.65)"
              : "rgba(34, 197, 94, 0.55)",
            pointerEvents:  "none",
            zIndex:         50,
          }}
        >
          <div
            style={{
              padding:      "12px 18px",
              borderRadius: 12,
              background:   "#fff",
              border:       `3px solid ${isReject ? "var(--red-600)" : "var(--green-d, #15803d)"}`,
              color:        isReject ? "var(--red-600)" : "var(--green-d, #15803d)",
              fontWeight:   900,
              fontSize:     14,
              textTransform:"uppercase",
              letterSpacing:"0.05em",
              transform:    `rotate(${isReject ? -8 : 8}deg)`,
              boxShadow:    "0 6px 18px rgba(0,0,0,0.25)",
              textAlign:    "center",
              maxWidth:     "85%",
            }}
          >
            {isReject ? "❌ NO ES" : "✅ SÍ ES"}<br />
            <span style={{ fontSize: 11, fontWeight: 600 }}>
              {tagDisplay}
            </span>
          </div>
        </div>
      )}

      {/* (Botones flotantes "No es / Sí es" eliminados — solo drag
          swipe. Tapaban contenido visual del tile. El drag a izquierda/
          derecha sigue funcionando con el overlay visual durante el
          gesto. Acción de escritura → reservada a ADMIN por endpoint
          (requireAdmin) + layout /admin que ya restringe acceso.) */}

      {/* Banner de error si el endpoint falló */}
      {error && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0,
          padding: "4px 8px", fontSize: 10, fontWeight: 700,
          background: "var(--red-600)", color: "#fff", zIndex: 60,
          textAlign: "center",
        }}>
          Error: {error.slice(0, 60)}
        </div>
      )}
    </div>

    {/* Toast "Deshacer" — portal al body para evitar el stacking context del tile */}
    {undoPending && mounted && createPortal(
      <div
        style={{
          position:      "fixed",
          bottom:        24,
          left:          "50%",
          transform:     "translateX(-50%)",
          zIndex:        9999,
          background:    "#1e293b",
          color:         "#fff",
          borderRadius:  12,
          padding:       "12px 20px",
          display:       "flex",
          flexDirection: "column",
          gap:           8,
          boxShadow:     "0 8px 32px rgba(0,0,0,0.45)",
          fontSize:      13,
          fontWeight:    600,
          whiteSpace:    "nowrap",
          minWidth:      260,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ flex: 1 }}>
            Excluida de{" "}
            <b style={{ color: "#fb923c" }}>{tagDisplay}</b>
          </span>
          <button
            type="button"
            onClick={handleUndo}
            style={{
              background:    "rgba(255,255,255,0.12)",
              border:        "1px solid rgba(255,255,255,0.28)",
              borderRadius:  7,
              color:         "#fff",
              padding:       "4px 14px",
              cursor:        "pointer",
              fontSize:      12,
              fontWeight:    800,
              letterSpacing: "0.03em",
            }}
          >
            Deshacer
          </button>
          <span
            style={{
              fontSize:           11,
              opacity:            0.5,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {undoCountdown}s
          </span>
        </div>
        {/* Barra de progreso que se vacía en 5s */}
        <div style={{ height: 3, background: "rgba(255,255,255,0.12)", borderRadius: 999 }}>
          <div
            style={{
              height:           "100%",
              width:            `${(undoCountdown / 5) * 100}%`,
              background:       "#fb923c",
              borderRadius:     999,
              transition:       "width 1s linear",
            }}
          />
        </div>
      </div>,
      document.body,
    )}
  </>
  )
}

// ── CardHashUpdater ────────────────────────────────────────────────────

/**
 * Wrapper cliente que, al hacer click en el tile (fuera de links/botones),
 * actualiza el hash de la URL a `#img-<sha>` via `history.replaceState`.
 *
 * `ScrollToHashTarget` ya maneja ese hash para hacer scrollIntoView al
 * cargar/recargar la página — así si el usuario recarga, la vista vuelve
 * a posicionarse en la última imagen que tocó.
 *
 * `display: contents` evita añadir caja extra al layout (el hijo
 * participa directamente en el grid como si este wrapper no existiera).
 */
export function CardHashUpdater({ sha, children }: { sha: string; children: ReactNode }) {
  return (
    <div
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button")) return
        const url = new URL(window.location.href)
        url.hash = `img-${sha}`
        history.replaceState(null, "", url.toString())
      }}
      style={{ display: "contents" }}
    >
      {children}
    </div>
  )
}
