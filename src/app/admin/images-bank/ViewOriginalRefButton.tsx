"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"

/**
 * Botón inline para previsualizar la imagen ORIGINAL desde una card
 * pendiente. Sustituye al `<code>{originalSha.slice(0, 8)}…</code>`
 * estático del footer pending. Click → modal con la imagen original
 * a tamaño grande, renderizado vía portal para escapar el
 * overflow:hidden del tile + transform del SwipeableImageTile.
 *
 * Si `originalImageUrl` es null (el SHA original ya no está en
 * classification — fue borrado tras descargar refs), el botón se
 * pinta inactivo (sin click, sin modal).
 */

interface Props {
  originalSha:      string
  originalImageUrl: string | null
}

export function ViewOriginalRefButton({ originalSha, originalImageUrl }: Props) {
  const [open,    setOpen]    = useState(false)
  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true) }, [])

  const disabled = !originalImageUrl

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          if (!disabled) setOpen(true)
        }}
        // Anti-swipe: el tile puede estar dentro de SwipeableImageTile
        // que captura mousedown/touchstart. stopPropagation aquí evita
        // disparar un swipe accidental al hacer click en el SHA.
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        title={
          disabled
            ? "El SHA original ya no está en el banco — no se puede previsualizar"
            : "Ver la imagen original (de la que se descargó esta referencia)"
        }
        style={{
          // Estilo inline mínimo — encaja con el text del footer (font-mono).
          background:   "transparent",
          border:       0,
          padding:      0,
          margin:       0,
          font:         "inherit",
          color:        disabled ? "inherit" : "var(--indigo-700, #4338ca)",
          textDecoration: disabled ? "none" : "underline dotted",
          textDecorationThickness: "1px",
          textUnderlineOffset: 2,
          cursor:       disabled ? "default" : "pointer",
          opacity:      disabled ? 0.6 : 1,
        }}
      >
        <code style={{ fontSize: "inherit" }}>{originalSha.slice(0, 8)}…</code>
      </button>

      {open && mounted && originalImageUrl && createPortal(
        <ViewOriginalRefModal
          originalSha={originalSha}
          originalImageUrl={originalImageUrl}
          onClose={() => setOpen(false)}
        />,
        document.body,
      )}
    </>
  )
}

function ViewOriginalRefModal({
  originalSha,
  originalImageUrl,
  onClose,
}: { originalSha: string; originalImageUrl: string; onClose: () => void }) {
  // Bloquear scroll del body mientras está abierto + ESC cierra.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onClose() }
    }
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label={`Imagen original ${originalSha.slice(0, 12)}`}
      style={{
        position:       "fixed",
        inset:          0,
        background:     "rgba(15, 23, 42, 0.75)",
        backdropFilter: "blur(4px)",
        zIndex:         800,
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
          borderRadius:  14,
          maxWidth:      "min(900px, 92vw)",
          maxHeight:     "90vh",
          display:       "flex",
          flexDirection: "column",
          overflow:      "hidden",
          boxShadow:     "0 30px 80px rgba(0,0,0,0.5)",
        }}
      >
        <header style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          padding:        "12px 18px",
          borderBottom:   "1px solid var(--slate-200)",
          background:     "var(--slate-50, #f8fafc)",
        }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>
              Imagen original
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--slate-500)" }}>
              SHA: <code>{originalSha}</code>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              border: 0, background: "transparent", padding: 8,
              cursor: "pointer", color: "var(--slate-600)",
              borderRadius: 8, display: "inline-flex",
            }}
          >
            <X size={18} />
          </button>
        </header>
        <div style={{
          padding:      20,
          background:   "var(--slate-900, #0f172a)",
          flex:         1,
          display:      "flex",
          alignItems:   "center",
          justifyContent: "center",
          minHeight:    200,
          overflow:     "auto",
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={originalImageUrl}
            alt={`Original ${originalSha.slice(0, 12)}`}
            style={{
              maxWidth:  "100%",
              maxHeight: "70vh",
              display:   "block",
              objectFit: "contain",
            }}
          />
        </div>
        <footer style={{
          padding: "10px 18px",
          borderTop: "1px solid var(--slate-200)",
          background: "var(--slate-50, #f8fafc)",
          fontSize: 11,
          color: "var(--slate-500)",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
        }}>
          <span>Esta es la imagen del banco DE LA QUE se descargó la referencia actualmente abierta.</span>
          <a
            href={originalImageUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--indigo-700)", fontWeight: 600, textDecoration: "none" }}
          >
            Abrir en pestaña nueva
          </a>
        </footer>
      </div>
    </div>
  )
}
