"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { Trash2, X, AlertTriangle, Loader2, Check } from "lucide-react"

/**
 * Botón "borrar imagen del banco" — admin only (todo /admin/* gateado
 * en layout.tsx). Click → modal de confirmación con custom Yes/No.
 *
 * El endpoint POST /api/admin/images-bank/delete-image:
 *   - Si la imagen tiene preguntas asociadas (Question.imagen), devuelve
 *     409 con la lista. El modal muestra esa info y ofrece "borrar de
 *     todas formas" que envía `force: true` (las preguntas se quedan
 *     con imagen=null).
 *   - Si OK, borra: binario R2 + entries en classification, confirmations,
 *     exclusions, manual_tags, alternative_references.
 *
 * Mismo patrón anti-swipe que la lupa: stopPropagation en mousedown /
 * touchstart / pointerdown para no disparar el swipe del tile padre.
 * Portal al body para escapar overflow:hidden + transform.
 */

interface Props {
  sha:      string
  filename: string
}

interface AffectedQuestion {
  id:         number
  externalId: string
  imagen:     string
}

interface DeleteResponse {
  ok:                boolean
  error?:            string
  code?:             string
  affectedQuestions?: AffectedQuestion[]
  deletedFromR2?:    boolean
  questionsNulled?:  number
  warn?:             string
}

export function DeleteImageButton({ sha, filename }: Props) {
  const [open,    setOpen]    = useState(false)
  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true) }, [])

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
        title="Borrar imagen del banco"
        aria-label="Borrar imagen del banco"
        style={{
          display:        "inline-flex",
          alignItems:     "center",
          justifyContent: "center",
          width:          22,
          height:         22,
          border:         0,
          background:     "rgba(239, 68, 68, 0.10)",
          color:          "var(--red-600, #dc2626)",
          borderRadius:   4,
          cursor:         "pointer",
          padding:        0,
          flexShrink:     0,
          touchAction:    "none",
        }}
      >
        <Trash2 size={11} />
      </button>
      {open && mounted && createPortal(
        <DeleteImageModal sha={sha} filename={filename} onClose={() => setOpen(false)} />,
        document.body,
      )}
    </>
  )
}

function DeleteImageModal({ sha, filename, onClose }: Props & { onClose: () => void }) {
  const router = useRouter()
  const [phase, setPhase] = useState<"confirm" | "blocked-by-questions" | "deleting" | "done">("confirm")
  const [error,             setError]             = useState<string | null>(null)
  const [affectedQuestions, setAffectedQuestions] = useState<AffectedQuestion[]>([])
  const [result,            setResult]            = useState<DeleteResponse | null>(null)

  // Bloquear scroll body
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = prev }
  }, [])

  // ESC cierra (excepto durante delete)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && phase !== "deleting") {
        e.preventDefault()
        handleClose()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  function handleClose() {
    // Si borramos algo, refrescar la página padre — la card desaparecerá
    if (phase === "done") router.refresh()
    onClose()
  }

  async function doDelete(force: boolean) {
    setPhase("deleting")
    setError(null)
    try {
      const res = await fetch("/api/admin/images-bank/delete-image", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ sha, force }),
      })
      const data = (await res.json()) as DeleteResponse
      if (res.status === 409 && data.code === "HAS_QUESTIONS") {
        // Pregunta confirmación con info de las afectadas
        setAffectedQuestions(data.affectedQuestions ?? [])
        setPhase("blocked-by-questions")
        return
      }
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`)
        setPhase("confirm")
        return
      }
      setResult(data)
      setPhase("done")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase("confirm")
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar borrado de imagen"
      style={{
        position:       "fixed",
        inset:          0,
        background:     "rgba(15, 23, 42, 0.55)",
        backdropFilter: "blur(3px)",
        zIndex:         600,
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
          overflow:      "auto",
          boxShadow:     "0 30px 80px rgba(0,0,0,0.4)",
          display:       "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <header style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          padding:        "14px 22px",
          borderBottom:   "1px solid var(--slate-200)",
          background:     "rgba(239, 68, 68, 0.06)",
        }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, display: "flex", alignItems: "center", gap: 8, color: "var(--red-700, #b91c1c)" }}>
            <Trash2 size={16} />
            Borrar imagen del banco
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={phase === "deleting"}
            aria-label="Cerrar"
            style={{
              border: 0, background: "transparent", padding: 8,
              cursor: phase === "deleting" ? "not-allowed" : "pointer",
              color: "var(--slate-600)",
              borderRadius: 8, display: "inline-flex",
              opacity: phase === "deleting" ? 0.4 : 1,
            }}
          >
            <X size={18} />
          </button>
        </header>

        {/* Body */}
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--slate-700)", lineHeight: 1.5 }}>
            Vas a borrar la imagen:
          </p>
          <code style={{
            display: "inline-block", padding: "6px 10px", background: "var(--slate-100)",
            borderRadius: 6, fontSize: 11, color: "var(--slate-700)",
            wordBreak: "break-all", fontFamily: "var(--font-mono)",
          }}>
            {filename}
            <br />
            <span style={{ fontSize: 10, color: "var(--slate-500)" }}>SHA: {sha.slice(0, 16)}…</span>
          </code>

          {phase === "confirm" && (
            <>
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--slate-600)", lineHeight: 1.5 }}>
                Esto borrará el binario de R2 + las entradas asociadas en{" "}
                <code>classification.json</code>, <code>tag_confirmations.json</code>,{" "}
                <code>tag_exclusions.json</code>, <code>manual_tags.json</code> y{" "}
                <code>alternative_references.json</code>. <strong>No es reversible</strong>.
              </p>
              {error && (
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  padding: 10, borderRadius: 8,
                  background: "rgba(239, 68, 68, 0.08)",
                  color: "var(--red-700, #b91c1c)",
                  fontSize: 12.5,
                }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}

          {phase === "blocked-by-questions" && (
            <div style={{
              padding: 12, borderRadius: 8,
              background: "rgba(245, 158, 11, 0.10)",
              border: "1px solid rgba(245, 158, 11, 0.35)",
              color: "var(--amber-d, #b45309)",
              fontSize: 12.5,
              lineHeight: 1.5,
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <strong>{affectedQuestions.length} pregunta{affectedQuestions.length === 1 ? "" : "s"} usa{affectedQuestions.length === 1 ? "" : "n"} esta imagen.</strong>
              </div>
              <p style={{ margin: "0 0 8px", fontSize: 12 }}>
                Si confirmas el borrado, esas preguntas quedarán con <code>imagen = null</code>{" "}
                (sin imagen, no rotas). Mejor reemplazarlas primero por otra imagen y luego borrar esta.
              </p>
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 600 }}>
                  Ver {affectedQuestions.length} pregunta{affectedQuestions.length === 1 ? "" : "s"} afectada{affectedQuestions.length === 1 ? "" : "s"}
                </summary>
                <ul style={{ margin: "6px 0 0", padding: "0 0 0 18px", fontSize: 11, fontFamily: "var(--font-mono)" }}>
                  {affectedQuestions.slice(0, 50).map((q) => (
                    <li key={q.id}>#{q.id} · {q.externalId}</li>
                  ))}
                  {affectedQuestions.length > 50 && (
                    <li style={{ color: "var(--slate-500)" }}>
                      … y {affectedQuestions.length - 50} más
                    </li>
                  )}
                </ul>
              </details>
            </div>
          )}

          {phase === "deleting" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--slate-600)", fontSize: 13 }}>
              <Loader2 size={16} className="spin-animate" />
              Borrando…
            </div>
          )}

          {phase === "done" && result && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              padding: 12, borderRadius: 8,
              background: "rgba(34, 197, 94, 0.10)",
              border: "1px solid rgba(34, 197, 94, 0.35)",
              color: "var(--green-700, #15803d)",
              fontSize: 12.5,
              lineHeight: 1.5,
            }}>
              <Check size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <strong>Borrada.</strong>
                <ul style={{ margin: "6px 0 0", padding: "0 0 0 18px", fontSize: 11.5 }}>
                  <li>Binario R2: {result.deletedFromR2 ? "✓" : "(ya no estaba)"}</li>
                  {result.questionsNulled !== undefined && result.questionsNulled > 0 && (
                    <li>Preguntas con <code>imagen=null</code>: {result.questionsNulled}</li>
                  )}
                  {result.warn && <li style={{ color: "var(--amber-d)" }}>⚠ {result.warn}</li>}
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer con acciones */}
        <footer style={{
          padding:        "12px 22px",
          borderTop:      "1px solid var(--slate-200)",
          background:     "var(--slate-50, #f8fafc)",
          display:        "flex",
          justifyContent: "flex-end",
          gap:            8,
        }}>
          {phase === "confirm" && (
            <>
              <button
                type="button"
                onClick={handleClose}
                style={{
                  padding: "8px 16px", border: "1px solid var(--slate-300)",
                  background: "#fff", color: "var(--slate-700)",
                  borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => doDelete(false)}
                style={{
                  padding: "8px 16px", border: 0,
                  background: "var(--red-600, #dc2626)", color: "#fff",
                  borderRadius: 8, fontSize: 12.5, fontWeight: 700,
                  cursor: "pointer",
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}
              >
                <Trash2 size={12} />
                Borrar
              </button>
            </>
          )}

          {phase === "blocked-by-questions" && (
            <>
              <button
                type="button"
                onClick={handleClose}
                style={{
                  padding: "8px 16px", border: "1px solid var(--slate-300)",
                  background: "#fff", color: "var(--slate-700)",
                  borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => doDelete(true)}
                style={{
                  padding: "8px 16px", border: 0,
                  background: "var(--red-600, #dc2626)", color: "#fff",
                  borderRadius: 8, fontSize: 12.5, fontWeight: 700,
                  cursor: "pointer",
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}
              >
                <Trash2 size={12} />
                Borrar igualmente · {affectedQuestions.length} preguntas a NULL
              </button>
            </>
          )}

          {phase === "deleting" && (
            <button
              type="button"
              disabled
              style={{
                padding: "8px 16px", border: 0,
                background: "var(--slate-400)", color: "#fff",
                borderRadius: 8, fontSize: 12.5, fontWeight: 700,
                cursor: "not-allowed",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              <Loader2 size={12} className="spin-animate" />
              Borrando…
            </button>
          )}

          {phase === "done" && (
            <button
              type="button"
              onClick={handleClose}
              style={{
                padding: "8px 16px", border: 0,
                background: "var(--green, #16a34a)", color: "#fff",
                borderRadius: 8, fontSize: 12.5, fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Cerrar
            </button>
          )}
        </footer>

        <style jsx global>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          .spin-animate { animation: spin 0.8s linear infinite; }
        `}</style>
      </div>
    </div>
  )
}
