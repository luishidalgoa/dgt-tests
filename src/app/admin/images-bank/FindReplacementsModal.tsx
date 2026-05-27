"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Search, X, Check, AlertCircle, ExternalLink, Loader2 } from "lucide-react"

/**
 * Botón + modal "estilo Google Lens" para reemplazar la imagen actual de
 * una pregunta DGT por un candidato con licencia libre (Pixabay/Pexels/
 * Unsplash).
 *
 * Flow:
 *   1. Admin clica botón `<Search />` en el tile
 *   2. Se abre el modal, dispara POST /api/admin/images-bank/find-replacements
 *      con la sha de la imagen actual
 *   3. Backend determina el keyword (tag confident principal en español)
 *      y llama stock APIs
 *   4. Modal renderiza grid de candidatos
 *   5. Admin clica "Reemplazar" en uno
 *   6. POST /api/admin/images-bank/replace-image descarga + sube R2 +
 *      actualiza Question.imagen en BBDD para todas las Q que usaban la sha vieja
 *   7. Modal se cierra + router.refresh() → page.tsx re-render con la nueva
 */

// Mirror del shape devuelto por el endpoint find-replacements
interface Candidate {
  url:          string
  thumbnailUrl: string
  sourceUrl:    string
  provider:     "pixabay" | "unsplash" | "pexels" | "serpapi"
  width:        number
  height:       number
  imageType:    "photo" | "illustration" | "vector" | "any"
  license:      string
  tags?:        string[]
  attribution?: string
  contentType?: string
}

interface FindRepResponse {
  ok:            boolean
  error?:        string
  keyword?:      string
  providersUsed?: string[]
  candidates?:   Candidate[]
}

interface ReplaceResponse {
  ok:                boolean
  error?:            string
  newSha?:           string
  newFilename?:      string
  questionsUpdated?: number
}

interface Props {
  sha:           string
  currentTags?:  Array<{ tag: string; score: number; confident: boolean }>
}

export function FindReplacementsButton({ sha, currentTags }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          setOpen(true)
        }}
        title="Buscar reemplazo (Google Lens style)"
        aria-label="Buscar imagen de reemplazo"
        style={{
          display:        "inline-flex",
          alignItems:     "center",
          justifyContent: "center",
          width:          22,
          height:         22,
          border:         0,
          background:     "rgba(99, 102, 241, 0.12)",
          color:          "var(--indigo-600, #6366f1)",
          borderRadius:   4,
          cursor:         "pointer",
          padding:        0,
          flexShrink:     0,
        }}
      >
        <Search size={12} />
      </button>
      {open && (
        <FindReplacementsModal
          sha={sha}
          currentTags={currentTags}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function FindReplacementsModal({
  sha,
  currentTags,
  onClose,
}: Props & { onClose: () => void }) {
  const router = useRouter()
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [keyword,    setKeyword]    = useState<string>("")
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [providers,  setProviders]  = useState<string[]>([])
  const [replacing,  setReplacing]  = useState<string | null>(null)  // url del candidato en proceso
  const [success,    setSuccess]    = useState<string | null>(null)  // mensaje de éxito

  // ── Búsqueda inicial al abrir el modal ─────────────────────────────
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch("/api/admin/images-bank/find-replacements", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ sha, max: 12 }),
        })
        const data = (await res.json()) as FindRepResponse
        if (cancelled) return
        if (!res.ok || !data.ok) {
          setError(data.error ?? `HTTP ${res.status}`)
          setLoading(false)
          return
        }
        setKeyword(data.keyword ?? "")
        setCandidates(data.candidates ?? [])
        setProviders(data.providersUsed ?? [])
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [sha])

  // ── Bloquear scroll del body mientras el modal está abierto ──────
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = prev }
  }, [])

  // ── Replace handler ───────────────────────────────────────────────
  async function handleReplace(candidate: Candidate) {
    if (replacing) return
    const confirmed = window.confirm(
      `¿Reemplazar la imagen actual con esta de ${candidate.provider}?\n\n` +
      `Esto sube la nueva a R2 y actualiza Question.imagen en BBDD para TODAS ` +
      `las preguntas que usan esta imagen. La imagen vieja se mantiene en R2 ` +
      `(no se borra).\n\n` +
      `Autor: ${candidate.attribution ?? "?"}\nLicencia: ${candidate.license}`,
    )
    if (!confirmed) return

    setReplacing(candidate.url)
    setError(null)
    try {
      const res = await fetch("/api/admin/images-bank/replace-image", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          originalSha:  sha,
          candidateUrl: candidate.url,
        }),
      })
      const data = (await res.json()) as ReplaceResponse
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`)
        setReplacing(null)
        return
      }
      setSuccess(
        `✅ Reemplazada — nuevo SHA ${data.newSha?.slice(0, 12)}… · ` +
        `${data.questionsUpdated} preguntas actualizadas`,
      )
      // Refresh page after a short delay so user sees confirmation
      setTimeout(() => {
        router.refresh()
        onClose()
      }, 1400)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setReplacing(null)
    }
  }

  // ── Tag confident principal como contexto visual ─────────────────
  const topConfidentTag = currentTags?.find((t) => t.confident)?.tag
                       ?? currentTags?.[0]?.tag
                       ?? "(sin tag)"

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Buscador de reemplazo de imagen"
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
          maxWidth:      1100,
          width:         "100%",
          maxHeight:     "90vh",
          overflow:      "auto",
          boxShadow:     "0 30px 80px rgba(0,0,0,0.4)",
          display:       "flex",
          flexDirection: "column",
        }}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <header
          style={{
            display:        "flex",
            alignItems:     "center",
            justifyContent: "space-between",
            padding:        "14px 22px",
            borderBottom:   "1px solid var(--slate-200)",
            background:     "var(--slate-50, #f8fafc)",
            position:       "sticky",
            top:            0,
            zIndex:         1,
            gap:            12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
              <Search size={16} />
              Buscar reemplazo
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--slate-500)" }}>
              SHA: <code>{sha.slice(0, 12)}…</code> · Tag principal: <strong>{topConfidentTag}</strong>
              {keyword && (
                <>
                  {" · "}Keyword: <strong>{keyword}</strong>
                </>
              )}
              {providers.length > 0 && (
                <>
                  {" · "}Providers: <em>{providers.join(", ")}</em>
                </>
              )}
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

        {/* ── Body ─────────────────────────────────────────────────── */}
        <div style={{ padding: 22, flex: 1 }}>
          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--slate-500)", padding: "20px 0" }}>
              <Loader2 size={16} className="spin" />
              Buscando candidatos en {providers.length > 0 ? providers.join(", ") : "los providers configurados"}...
            </div>
          )}

          {error && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              padding: 12, borderRadius: 8,
              background: "rgba(239, 68, 68, 0.08)",
              color: "var(--red-700, #b91c1c)",
              fontSize: 13,
              marginBottom: 16,
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <strong>Error:</strong> {error}
                {error.includes("No hay provider") && (
                  <p style={{ margin: "8px 0 0", fontSize: 12 }}>
                    Soluciones:
                    <br />• Pixabay (recomendado): registrarse en{" "}
                    <a href="https://pixabay.com/accounts/register/" target="_blank" rel="noopener noreferrer">
                      pixabay.com
                    </a>{" "}
                    y añadir <code>PIXABAY_API_KEY</code> a <code>.env.local</code>
                    <br />• Pexels: registro en{" "}
                    <a href="https://www.pexels.com/api/" target="_blank" rel="noopener noreferrer">
                      pexels.com
                    </a>{" "}
                    → <code>PEXELS_API_KEY</code>
                    <br />• Unsplash:{" "}
                    <a href="https://unsplash.com/developers" target="_blank" rel="noopener noreferrer">
                      unsplash.com
                    </a>{" "}
                    → <code>UNSPLASH_ACCESS_KEY</code>
                  </p>
                )}
              </div>
            </div>
          )}

          {success && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: 12, borderRadius: 8,
              background: "rgba(34, 197, 94, 0.10)",
              color: "var(--green-700, #15803d)",
              fontSize: 13,
              marginBottom: 16,
            }}>
              <Check size={16} />
              {success}
            </div>
          )}

          {!loading && !error && candidates.length === 0 && (
            <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--slate-500)", fontSize: 14 }}>
              Sin candidatos para <strong>{keyword}</strong>. Prueba con otro keyword o swipea esta imagen
              como “sin tag” para que el modelo sugiera otro label.
            </div>
          )}

          {!loading && candidates.length > 0 && (
            <div
              style={{
                display:             "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                gap:                 14,
              }}
            >
              {candidates.map((c) => (
                <CandidateCard
                  key={c.url}
                  candidate={c}
                  onReplace={() => handleReplace(c)}
                  replacing={replacing === c.url}
                  disabled={Boolean(replacing) || Boolean(success)}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────── */}
        <footer style={{
          padding:    "10px 22px",
          borderTop:  "1px solid var(--slate-200)",
          background: "var(--slate-50, #f8fafc)",
          fontSize:   11.5,
          color:      "var(--slate-500)",
        }}>
          Stock APIs gratuitas (Pixabay/Pexels/Unsplash) con licencia libre comercial. Al reemplazar, la imagen vieja se mantiene en R2 — solo se actualiza <code>Question.imagen</code> en BBDD.
        </footer>
      </div>

      <style jsx global>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.8s linear infinite; }
      `}</style>
    </div>
  )
}

// ── CandidateCard ────────────────────────────────────────────────────
function CandidateCard({
  candidate,
  onReplace,
  replacing,
  disabled,
}: {
  candidate: Candidate
  onReplace: () => void
  replacing: boolean
  disabled:  boolean
}) {
  return (
    <div style={{
      border:       "1px solid var(--slate-200)",
      borderRadius: 10,
      overflow:     "hidden",
      background:   "#fff",
      display:      "flex",
      flexDirection: "column",
    }}>
      <div style={{
        position: "relative", width: "100%", aspectRatio: "1 / 1",
        background: "var(--slate-100)",
      }}>
        {/* next/image necesita configurar el domain en next.config — usamos <img> nativo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={candidate.thumbnailUrl}
          alt={candidate.attribution ?? "candidate"}
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
        <span style={{
          position: "absolute", top: 6, left: 6,
          background: "rgba(15, 23, 42, 0.75)",
          color: "#fff", fontSize: 9.5, fontWeight: 700,
          padding: "2px 6px", borderRadius: 4, textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}>
          {candidate.provider}
        </span>
        <span style={{
          position: "absolute", bottom: 6, right: 6,
          background: "rgba(15, 23, 42, 0.75)",
          color: "#fff", fontSize: 9, padding: "2px 5px", borderRadius: 3,
          fontFamily: "var(--font-mono)",
        }}>
          {candidate.width}×{candidate.height}
        </span>
      </div>
      <div style={{ padding: "8px 10px", flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 11, color: "var(--slate-600)", lineHeight: 1.35, minHeight: 30 }}>
          <span style={{ fontWeight: 600 }}>{candidate.attribution ?? "Anon"}</span>
          {" · "}
          <span style={{ fontSize: 10, color: "var(--slate-500)" }}>{candidate.license}</span>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <button
            type="button"
            onClick={onReplace}
            disabled={disabled}
            style={{
              flex:           1,
              padding:        "6px 8px",
              border:         0,
              background:     replacing
                                ? "var(--slate-400)"
                                : "var(--indigo-600, #6366f1)",
              color:          "#fff",
              borderRadius:   6,
              fontSize:       11.5,
              fontWeight:     700,
              cursor:         disabled ? "not-allowed" : "pointer",
              opacity:        disabled && !replacing ? 0.5 : 1,
              display:        "inline-flex",
              alignItems:     "center",
              justifyContent: "center",
              gap:            5,
              transition:     "background 0.15s",
            }}
          >
            {replacing ? (
              <>
                <Loader2 size={11} className="spin" />
                Reemplazando…
              </>
            ) : (
              <>
                <Check size={11} />
                Reemplazar
              </>
            )}
          </button>
          <a
            href={candidate.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Ver fuente original"
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              padding: "6px 8px", border: "1px solid var(--slate-300)",
              borderRadius: 6, color: "var(--slate-600)", background: "#fff",
              textDecoration: "none",
            }}
          >
            <ExternalLink size={11} />
          </a>
        </div>
      </div>
    </div>
  )
}
