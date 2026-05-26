"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X, ZoomIn } from "lucide-react"

interface Props {
  src: string
  alt: string
  /**
   * Si se pasa, sobreescribe la acción de click: en vez de abrir el
   * lightbox, dispara este callback (modo "picker" — el usuario hace
   * click para SELECCIONAR la imagen). En ese modo, el zoom queda
   * disponible como botón flotante en la esquina superior derecha
   * (con stopPropagation para no disparar también el select).
   *
   * Si NO se pasa, click sobre el tile abre zoom (modo galería).
   */
  onClick?: () => void
}

/**
 * Thumbnail con lazy load REAL vía IntersectionObserver + click para zoom
 * o selección (si se pasa `onClick`).
 *
 * Por qué no `<Image loading="lazy">` o `<img loading="lazy">` nativos:
 *   - El lazy nativo del browser es conservador — con 60 tiles renderizados
 *     y página corta, dispara casi todos los fetches al cargar (considera
 *     "near viewport" cualquier cosa a unas pantallas de distancia).
 *   - Aquí controlamos explícitamente: el <img> ni siquiera se monta en
 *     el DOM hasta que el tile está a <300px de entrar en viewport.
 *   - Al cargarse desconectamos el observer (cero coste residual).
 *
 * Zoom (click sobre la imagen, modo galería):
 *   - Abre un lightbox modal full-screen con la imagen a tamaño real
 *     (max 95vw / 95vh, object-fit: contain — preserva aspect ratio).
 *   - ESC, click en backdrop o botón X cierran.
 *   - Mientras está abierto, bloqueamos scroll del body para evitar
 *     que el grid de abajo se desplace.
 *
 * Picker mode (`onClick` prop):
 *   - El click del tile dispara `onClick` (típicamente "seleccionar
 *     este filename" + cerrar modal padre).
 *   - El zoom sigue disponible vía botón flotante en esquina sup-der.
 *
 * Usa `<img>` plano en vez de Next/Image porque:
 *   - QuestionImage ya usa `unoptimized` → Next/Image solo envolvería
 *     un `<img>` igual, con peso JS extra.
 *   - El src es absoluto a public/images/, sin transformación.
 *
 * Fade-in suave al cargar para que no haya pop visual.
 */
export function LazyTileImage({ src, alt, onClick }: Props) {
  const [visible,  setVisible]  = useState(false)
  const [loaded,   setLoaded]   = useState(false)
  const [zoomed,   setZoomed]   = useState(false)
  const [mounted,  setMounted]  = useState(false)
  const ref = useRef<HTMLButtonElement | null>(null)

  // SSR-safe: createPortal solo funciona en el cliente
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true) }, [])

  // IntersectionObserver para lazy-load
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: "300px", threshold: 0 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // ESC para cerrar zoom + bloqueo de scroll del body mientras está abierto
  useEffect(() => {
    if (!zoomed) return

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setZoomed(false)
    }

    window.addEventListener("keydown", onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [zoomed])

  const canZoom = visible && loaded
  const pickerMode = typeof onClick === "function"

  // Click sobre el tile:
  //   - picker mode → seleccionar (callback)
  //   - galería    → abrir zoom
  // Si la imagen no está cargada todavía, ignoramos clicks (cursor default).
  function handleTileClick() {
    if (!canZoom) return
    if (pickerMode) onClick!()
    else            setZoomed(true)
  }

  // El icono de la esquina:
  //   - picker mode → BOTÓN real que abre zoom (stopPropagation para no
  //                   disparar el select). Visible siempre con baja opacidad,
  //                   full opacidad al hover del tile.
  //   - galería    → decorativo (solo opacidad fade-in al hover).
  const overlayLabel = pickerMode ? "Ampliar imagen (no selecciona)" : "Ampliar imagen"

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={handleTileClick}
        aria-label={
          canZoom
            ? pickerMode
              ? `Seleccionar imagen ${alt}`
              : `Ampliar imagen ${alt}`
            : "Cargando..."
        }
        style={{
          position:     "relative",
          aspectRatio:  "1",
          background:   "var(--slate-100)",
          overflow:     "hidden",
          cursor:       canZoom ? (pickerMode ? "pointer" : "zoom-in") : "default",
          border:       0,
          padding:      0,
          width:        "100%",
          display:      "block",
        }}
        // Hover overlay vía manipulación directa (no inline porque no soporta :hover)
        onMouseEnter={(e) => {
          if (!canZoom) return
          const overlay = e.currentTarget.querySelector(".zoom-overlay") as HTMLElement | null
          if (overlay) overlay.style.opacity = "1"
        }}
        onMouseLeave={(e) => {
          const overlay = e.currentTarget.querySelector(".zoom-overlay") as HTMLElement | null
          // En picker mode dejamos opacidad baja (0.55) para que se vea siempre.
          if (overlay) overlay.style.opacity = pickerMode ? "0.55" : "0"
        }}
      >
        {visible && (
          <img
            src={src}
            alt={alt}
            decoding="async"
            onLoad={() => setLoaded(true)}
            style={{
              position:    "absolute",
              inset:       0,
              width:       "100%",
              height:      "100%",
              objectFit:   "contain",
              opacity:     loaded ? 1 : 0,
              transition:  "opacity 0.18s ease-out",
              userSelect:  "none",
              pointerEvents: "none",  // que clicks pasen al <button>
            }}
          />
        )}
        {/* Icono de zoom en esquina:
            - picker mode → <span> renderizado como botón anidado
              (HTML inválido: button-in-button). Para evitarlo usamos
              role="button" + onClick con stopPropagation.
            - galería    → decorativo. */}
        {canZoom && (
          <div
            className="zoom-overlay"
            role={pickerMode ? "button" : undefined}
            tabIndex={pickerMode ? 0 : undefined}
            aria-label={pickerMode ? overlayLabel : undefined}
            onClick={pickerMode ? (e) => {
              e.stopPropagation()
              e.preventDefault()
              setZoomed(true)
            } : undefined}
            onKeyDown={pickerMode ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation()
                e.preventDefault()
                setZoomed(true)
              }
            } : undefined}
            style={{
              position:       "absolute",
              top:            6,
              right:          6,
              padding:        4,
              background:     "rgba(0,0,0,0.55)",
              borderRadius:   6,
              color:          "#fff",
              opacity:        pickerMode ? 0.55 : 0,
              transition:     "opacity 0.12s",
              pointerEvents:  pickerMode ? "auto" : "none",
              cursor:         pickerMode ? "zoom-in" : "default",
            }}
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </div>
        )}
      </button>

      {/* ── Lightbox modal ──────────────────────────────────────────────
          Portal a document.body para evitar que el `transform` del
          SwipeableImageTile padre rompa `position:fixed`. Sin portal,
          el fixed se ancla al contenedor transformado y el lightbox
          aparece recortado a nivel de tarjeta en lugar de pantalla
          completa. Mismo patrón que QuestionsListButton en BankUi.tsx. */}
      {zoomed && mounted && createPortal(
        <div
          onClick={() => setZoomed(false)}
          style={{
            position:       "fixed",
            inset:          0,
            background:     "rgba(0,0,0,0.88)",
            zIndex:         9999,
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            padding:        24,
            cursor:         "zoom-out",
            backdropFilter: "blur(4px)",
          }}
          role="dialog"
          aria-modal="true"
          aria-label={`Vista ampliada: ${alt}`}
        >
          {/* Botón cerrar arriba a la derecha */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setZoomed(false) }}
            aria-label="Cerrar vista ampliada"
            style={{
              position:     "absolute",
              top:          16,
              right:        16,
              background:   "rgba(255,255,255,0.12)",
              border:       "1px solid rgba(255,255,255,0.20)",
              borderRadius: 8,
              padding:      8,
              cursor:       "pointer",
              color:        "#fff",
              transition:   "background 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.22)" }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.12)" }}
          >
            <X className="h-5 w-5" />
          </button>

          {/* Hint inferior: "ESC para cerrar" */}
          <div
            style={{
              position:     "absolute",
              bottom:       16,
              left:         "50%",
              transform:    "translateX(-50%)",
              padding:      "6px 14px",
              background:   "rgba(255,255,255,0.10)",
              border:       "1px solid rgba(255,255,255,0.18)",
              borderRadius: 999,
              color:        "rgba(255,255,255,0.8)",
              fontSize:     11.5,
              fontWeight:   600,
              letterSpacing: "0.04em",
              pointerEvents: "none",
            }}
          >
            ESC o click fuera para cerrar
          </div>

          <img
            src={src}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth:    "95vw",
              maxHeight:   "95vh",
              objectFit:   "contain",
              boxShadow:   "0 30px 80px rgba(0,0,0,0.55)",
              borderRadius: 6,
              cursor:      "default",
            }}
          />
        </div>,
        document.body,
      )}
    </>
  )
}
