"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { Trash2, X, Loader2, ExternalLink, AlertCircle, RefreshCw } from "lucide-react"

/**
 * Chip "↻ N refs" clickable que abre un modal con la lista de refs
 * descargadas para este SHA original. Cada ref se muestra apilada con
 * thumbnail + metadata + botón delete.
 *
 * Sustituye al span estático que solo mostraba el contador. Misma
 * apariencia visual; el click abre el modal vía portal al body para
 * escapar el overflow:hidden del tile + transform del SwipeableImageTile.
 *
 * El delete llama a /api/admin/images-bank/delete-image — el mismo
 * endpoint que usa la papelera del tile, con CAS para evitar race
 * conditions. Tras el delete:
 *   - La ref desaparece del modal (estado local optimista).
 *   - El contador del header se decrementa en vivo.
 *   - Al cerrar el modal, router.refresh() para que el tile padre se
 *     repinte con el contador actualizado.
 *
 * Mismo patrón anti-swipe que los otros botones del tile.
 */

export interface RefItem {
  sha:           string
  ext:           string
  sourceUrl:     string
  provider:      string
  attribution?:  string
  downloadedAt:  string
  addedBy?:      string
  /** URL pública del binario en R2 (pre-resuelta en el server con
   *  imageUrl()). Las funciones no se pueden serializar cross-RSC,
   *  así que llegamos con la URL ya construida. */
  imageUrl:      string
}

interface Props {
  originalSha: string
  refs:        readonly RefItem[]
}

export function RefsListButton({ originalSha, refs }: Props) {
  const [open,    setOpen]    = useState(false)
  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true) }, [])

  if (refs.length === 0) return null

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          setOpen(true)
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        title={`Ver las ${refs.length} referencia${refs.length === 1 ? "" : "s"} descargadas para este SHA`}
        aria-label={`Ver ${refs.length} refs`}
        style={{
          fontSize:        9,
          fontWeight:      800,
          padding:         "1px 5px",
          borderRadius:    999,
          background:      "rgba(99, 102, 241, 0.15)",
          color:           "var(--indigo-700, #4338ca)",
          flexShrink:      0,
          letterSpacing:   "0.02em",
          textTransform:   "lowercase",
          border:          0,
          cursor:          "pointer",
          touchAction:     "none",
          display:         "inline-flex",
          alignItems:      "center",
          gap:             3,
        }}
      >
        ↻ {refs.length} ref{refs.length === 1 ? "" : "s"}
      </button>

      {open && mounted && createPortal(
        <RefsListModal
          originalSha={originalSha}
          refs={refs}
          onClose={() => setOpen(false)}
        />,
        document.body,
      )}
    </>
  )
}

function RefsListModal({
  originalSha,
  refs,
  onClose,
}: Props & { onClose: () => void }) {
  const router = useRouter()
  const [removedShas, setRemovedShas] = useState<Set<string>>(new Set())
  const [deletingSha, setDeletingSha] = useState<string | null>(null)
  const [error,       setError]       = useState<string | null>(null)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !deletingSha) { e.preventDefault(); handleClose() }
    }
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener("keydown", onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deletingSha])

  function handleClose() {
    // Si borramos algo, refrescar la página padre para que el contador
    // se actualice en el chip del tile.
    if (removedShas.size > 0) router.refresh()
    onClose()
  }

  async function handleDelete(sha: string) {
    if (deletingSha) return
    setDeletingSha(sha)
    setError(null)
    try {
      const res = await fetch("/api/admin/images-bank/delete-image", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ sha, force: false }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        // Si la ref tiene preguntas asociadas (caso edge, una ref ya
        // promovida a Question.imagen tras varios runs), mostramos el
        // error pero NO ofrecemos force aquí — el admin debería ir al
        // tile directo y usar la papelera principal.
        setError(data.error ?? `HTTP ${res.status}`)
        setDeletingSha(null)
        return
      }
      setRemovedShas((prev) => new Set([...prev, sha]))
      setDeletingSha(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setDeletingSha(null)
    }
  }

  const visibleRefs = refs.filter((r) => !removedShas.has(r.sha))

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label={`Referencias descargadas para ${originalSha.slice(0, 12)}`}
      style={{
        position:       "fixed",
        inset:          0,
        background:     "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(3px)",
        zIndex:         700,
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
          maxWidth:      560,
          width:         "100%",
          maxHeight:     "85vh",
          display:       "flex",
          flexDirection: "column",
          overflow:      "hidden",
          boxShadow:     "0 30px 80px rgba(0,0,0,0.4)",
        }}
      >
        {/* Header */}
        <header style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          padding:        "12px 18px",
          borderBottom:   "1px solid var(--slate-200)",
          background:     "var(--slate-50, #f8fafc)",
        }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
              <RefreshCw size={14} style={{ color: "var(--indigo-700, #4338ca)" }} />
              {visibleRefs.length} referencia{visibleRefs.length === 1 ? "" : "s"}
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--slate-500)" }}>
              de <code>{originalSha.slice(0, 16)}…</code>
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={Boolean(deletingSha)}
            aria-label="Cerrar"
            style={{
              border: 0, background: "transparent", padding: 8,
              cursor: deletingSha ? "not-allowed" : "pointer",
              color: "var(--slate-600)",
              borderRadius: 8, display: "inline-flex",
              opacity: deletingSha ? 0.4 : 1,
            }}
          >
            <X size={18} />
          </button>
        </header>

        {/* Body: lista de refs apiladas */}
        <div style={{ overflow: "auto", flex: 1, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {error && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              padding: 10, borderRadius: 8,
              background: "rgba(239, 68, 68, 0.08)",
              color: "var(--red-700, #b91c1c)",
              fontSize: 12,
            }}>
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              {error}
            </div>
          )}

          {visibleRefs.length === 0 && (
            <div style={{
              padding: 24, textAlign: "center", color: "var(--slate-500)",
              fontSize: 12.5,
            }}>
              Todas las refs han sido borradas. Cierra el modal para volver al banco.
            </div>
          )}

          {visibleRefs.map((ref) => {
            const isDeleting = deletingSha === ref.sha
            return (
              <div
                key={ref.sha}
                style={{
                  display:      "flex",
                  alignItems:   "stretch",
                  gap:          10,
                  padding:      8,
                  border:       "1px solid var(--slate-200)",
                  borderRadius: 10,
                  background:   isDeleting ? "var(--slate-50)" : "#fff",
                  opacity:      isDeleting ? 0.6 : 1,
                  transition:   "opacity 0.15s",
                }}
              >
                {/* Thumbnail */}
                <div style={{
                  width:        80,
                  height:       80,
                  flexShrink:   0,
                  borderRadius: 6,
                  overflow:     "hidden",
                  background:   "var(--slate-100)",
                  position:     "relative",
                }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ref.imageUrl}
                    alt={`ref ${ref.sha.slice(0, 8)}`}
                    loading="lazy"
                    style={{
                      width:     "100%",
                      height:    "100%",
                      objectFit: "cover",
                      display:   "block",
                    }}
                  />
                </div>

                {/* Metadata */}
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize:       9.5,
                      fontWeight:     800,
                      padding:        "1px 5px",
                      borderRadius:   4,
                      background:     "var(--indigo-100, #e0e7ff)",
                      color:          "var(--indigo-700, #4338ca)",
                      textTransform:  "uppercase",
                      letterSpacing:  "0.04em",
                    }}>
                      {ref.provider}
                    </span>
                    <span className="font-mono-tabular" style={{ fontSize: 9.5, color: "var(--slate-400)" }}>
                      {ref.sha.slice(0, 10)}…
                    </span>
                  </div>
                  {ref.attribution && (
                    <div style={{
                      fontSize:    11,
                      color:       "var(--slate-700)",
                      overflow:    "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace:  "nowrap",
                    }}>
                      <strong>{ref.attribution}</strong>
                    </div>
                  )}
                  <div style={{
                    fontSize:    10,
                    color:       "var(--slate-500)",
                  }}>
                    {new Date(ref.downloadedAt).toLocaleDateString("es-ES", {
                      year:  "numeric",
                      month: "short",
                      day:   "numeric",
                    })}
                    {ref.addedBy && <> · por <strong>{ref.addedBy}</strong></>}
                  </div>
                  {ref.sourceUrl && (
                    <a
                      href={ref.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{
                        fontSize:     10,
                        color:        "var(--indigo-700)",
                        textDecoration: "underline dotted",
                        textUnderlineOffset: 2,
                        display:      "inline-flex",
                        alignItems:   "center",
                        gap:          3,
                        marginTop:    1,
                        maxWidth:     "100%",
                        overflow:     "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace:   "nowrap",
                      }}
                    >
                      <ExternalLink size={9} />
                      {(() => {
                        try { return new URL(ref.sourceUrl).hostname.replace(/^www\./, "") }
                        catch { return ref.sourceUrl.slice(0, 40) }
                      })()}
                    </a>
                  )}
                </div>

                {/* Botón delete */}
                <button
                  type="button"
                  onClick={() => handleDelete(ref.sha)}
                  disabled={Boolean(deletingSha)}
                  title="Borrar esta ref del banco (binario R2 + entry del registry)"
                  style={{
                    flexShrink:    0,
                    alignSelf:     "center",
                    width:         32,
                    height:        32,
                    border:        0,
                    background:    "rgba(239, 68, 68, 0.10)",
                    color:         "var(--red-600, #dc2626)",
                    borderRadius:  8,
                    cursor:        deletingSha ? "not-allowed" : "pointer",
                    display:       "inline-flex",
                    alignItems:    "center",
                    justifyContent: "center",
                    opacity:       deletingSha && !isDeleting ? 0.4 : 1,
                  }}
                >
                  {isDeleting ? <Loader2 size={14} className="spin-rl" /> : <Trash2 size={14} />}
                </button>
              </div>
            )
          })}
        </div>

        <footer style={{
          padding:   "10px 18px",
          borderTop: "1px solid var(--slate-200)",
          background: "var(--slate-50, #f8fafc)",
          fontSize:  11,
          color:     "var(--slate-500)",
          lineHeight: 1.4,
        }}>
          Borrar una ref aquí elimina su binario en R2 y la entry en{" "}
          <code>alternative_references.json</code>. Si la ref ya está clasificada
          (tiene tags), también limpia <code>classification.json</code>.
        </footer>

        <style jsx global>{`
          @keyframes spin-rl { to { transform: rotate(360deg); } }
          .spin-rl { animation: spin-rl 0.8s linear infinite; }
        `}</style>
      </div>
    </div>
  )
}
