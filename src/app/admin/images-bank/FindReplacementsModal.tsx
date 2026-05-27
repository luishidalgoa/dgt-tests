"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { Search, X, Check, AlertCircle, ExternalLink, Loader2, RefreshCw, Sparkles, Database } from "lucide-react"

/**
 * Botón + modal para buscar referencias visuales alternativas y guardarlas
 * en el banco. La búsqueda usa stock APIs (Pixabay/Pexels) o Google Lens
 * (reverse image VISUAL real vía SerpAPI).
 *
 * Flow:
 *   1. Admin clica botón `<Search />` en el tile.
 *   2. Modal abre, dispara POST /api/admin/images-bank/find-replacements
 *      con la sha de la imagen actual + tab activo (stock|google).
 *   3. Backend devuelve candidatos.
 *   4. Modal pinta el grid + un badge con cuántas referencias ya hay
 *      guardadas para este sha (`refsCount` recibido del padre).
 *   5. Admin clica "Guardar referencia" en uno.
 *   6. POST /api/admin/images-bank/save-reference descarga el binario,
 *      lo sube a R2 como `<newSha>.<ext>` (sin tocar Question), y
 *      registra el vínculo en meta/alternative_references.json para
 *      poder llevar el seguimiento.
 *   7. El contador local del modal se incrementa; al cerrar, el padre
 *      revalidará con router.refresh().
 *
 * Las imágenes guardadas quedan huérfanas hasta que el clasificador
 * (siguiente run) las procese y les asigne tags.
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

/** Tab del buscador — cada uno mapea a un `providerSet` del endpoint:
 *    "stock"  → Pixabay + Pexels (free, calidad media para DGT)
 *    "google" → SerpAPI (Google Images con licencia CC, gasta quota) */
type ProviderSet = "stock" | "google"

// ── Cache en sessionStorage ───────────────────────────────────────────
// Por qué session y no localStorage: queremos que la búsqueda dure SOLO
// mientras el admin está en /admin/images-bank en esta sesión del navegador.
// Si cierra la pestaña y vuelve mañana, las stock APIs pueden tener nuevos
// resultados — no queremos servir un caché viejo. Y sobre todo, evita
// gastar quota de SerpAPI en cada reapertura del mismo modal.
// v2 → tab "google" pasó de search-por-keyword a Google Lens visual.
// Las cachés v1 quedan huérfanas (sessionStorage las purga al cerrar).
const CACHE_PREFIX = "findRepl:v2:"
function cacheKey(sha: string, set: ProviderSet): string {
  return `${CACHE_PREFIX}${sha}:${set}`
}
function readCache(sha: string, set: ProviderSet): FindRepResponse | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(cacheKey(sha, set))
    if (!raw) return null
    return JSON.parse(raw) as FindRepResponse
  } catch {
    return null
  }
}
function writeCache(sha: string, set: ProviderSet, data: FindRepResponse): void {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(cacheKey(sha, set), JSON.stringify(data))
  } catch {
    // QuotaExceededError o similar — ignoramos, el modal funciona igual sin caché.
  }
}
function clearCache(sha: string, set: ProviderSet): void {
  if (typeof window === "undefined") return
  try { window.sessionStorage.removeItem(cacheKey(sha, set)) } catch {}
}

interface SaveReferenceResponse {
  ok:                 boolean
  error?:             string
  newSha?:            string
  newFilename?:       string
  dedup?:             boolean
  totalForOriginal?:  number
}

interface Props {
  sha:           string
  currentTags?:  Array<{ tag: string; score: number; confident: boolean }>
  /** Cuántas referencias alternativas se han descargado ya para este
   *  SHA. El padre lo pasa desde page.tsx (lee meta/alternative_references.json).
   *  null/undefined = no se ha consultado todavía → no se pinta el badge. */
  refsCount?:    number
  /** True si ESTA imagen es ella misma una referencia descargada
   *  previamente (su SHA aparece como newSha en
   *  alternative_references.json). En ese caso el botón se ve
   *  desactivado: no tiene sentido buscar Lens sobre una imagen que ya
   *  está catalogada en internet — los resultados serían pobres o la
   *  propia imagen tal cual. */
  disabledBecauseIsRef?: boolean
}

export function FindReplacementsButton({ sha, currentTags, refsCount, disabledBecauseIsRef }: Props) {
  const [open, setOpen] = useState(false)
  // mounted: solo renderizamos el portal cuando ya estamos en cliente
  // (document existe). Sin esto, createPortal en SSR explota.
  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true) }, [])

  const hasRefs = typeof refsCount === "number" && refsCount > 0
  const isDisabled = disabledBecauseIsRef === true
  return (
    <>
      <button
        type="button"
        disabled={isDisabled}
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          if (isDisabled) return
          setOpen(true)
        }}
        // SwipeableImageTile inicia el drag con onMouseDown/onTouchStart —
        // si no paramos la propagación AQUÍ, el simple hecho de pulsar la
        // lupa empieza un swipe accidental. onClick llega tarde porque el
        // gesto ya arrancó. Mismo patrón que QuestionsListButton.
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        title={
          isDisabled
            ? "Esta imagen es ella misma una referencia descargada anteriormente. No tiene sentido buscarle más refs (ya está catalogada en internet)."
            : hasRefs
              ? `Buscar referencias visuales · ${refsCount} ya descargadas`
              : "Buscar referencias visuales (Google Lens / stock)"
        }
        aria-label={
          isDisabled
            ? "Búsqueda de referencias deshabilitada — esta imagen ya es una ref"
            : hasRefs
              ? `Buscar referencias, ${refsCount} ya descargadas`
              : "Buscar referencias visuales"
        }
        style={{
          position:       "relative",      // contenedor del badge
          display:        "inline-flex",
          alignItems:     "center",
          justifyContent: "center",
          width:          22,
          height:         22,
          border:         0,
          background:     isDisabled
            ? "var(--slate-100)"                    // desactivado → gris claro
            : hasRefs
              ? "rgba(99, 102, 241, 0.22)"          // refs → tinte fuerte
              : "rgba(99, 102, 241, 0.12)",
          color:          isDisabled
            ? "var(--slate-400)"
            : "var(--indigo-600, #6366f1)",
          borderRadius:   4,
          cursor:         isDisabled ? "not-allowed" : "pointer",
          padding:        0,
          flexShrink:     0,
          opacity:        isDisabled ? 0.55 : 1,
          // touchAction:none refuerza el bloqueo en móvil: el browser no
          // tratará el touch como pan/zoom y, sobre todo, lo entrega a
          // este botón antes que al wrapper de swipe del tile.
          touchAction:    "none",
        }}
      >
        <Search size={12} />
        {hasRefs && (
          <span
            aria-hidden="true"
            style={{
              position:       "absolute",
              top:            -5,
              right:          -5,
              minWidth:       14,
              height:         14,
              padding:        "0 3px",
              background:     "var(--indigo-600, #6366f1)",
              color:          "white",
              borderRadius:   999,
              fontSize:       9,
              fontWeight:     800,
              lineHeight:     1,
              display:        "inline-flex",
              alignItems:     "center",
              justifyContent: "center",
              boxShadow:      "0 0 0 1.5px white",  // anillo blanco para flotar sobre cualquier fondo
              fontFamily:     "var(--font-mono)",
            }}
          >
            {refsCount! > 99 ? "99+" : refsCount}
          </span>
        )}
      </button>
      {/* Portal al body — el tile padre tiene `overflow: hidden` y
          SwipeableImageTile usa `transform`, ambos crean un contain block
          que rompe `position: fixed`. Sin portal el modal se ve "dentro"
          del tile en vez de a pantalla completa. */}
      {open && mounted && createPortal(
        <FindReplacementsModal
          sha={sha}
          currentTags={currentTags}
          initialRefsCount={refsCount ?? 0}
          onClose={() => setOpen(false)}
        />,
        document.body,
      )}
    </>
  )
}

function FindReplacementsModal({
  sha,
  currentTags,
  initialRefsCount,
  onClose,
}: Props & { onClose: () => void; initialRefsCount: number }) {
  const router = useRouter()
  // Default "stock" porque es free y no gasta la quota cara de SerpAPI.
  // El admin tiene que clicar el otro tab para activar Google Lens.
  const [providerSet, setProviderSet] = useState<ProviderSet>("stock")
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [keyword,    setKeyword]    = useState<string>("")
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [providers,  setProviders]  = useState<string[]>([])
  const [saving,     setSaving]     = useState<string | null>(null)  // url del candidato en proceso
  const [success,    setSuccess]    = useState<string | null>(null)  // mensaje de éxito de la ÚLTIMA acción
  const [fromCache,  setFromCache]  = useState(false)
  // Refs guardadas total para este SHA — empieza con el valor que pasó
  // el padre (que lo leyó de R2) y se incrementa localmente con cada
  // guardado exitoso. El padre revalidará al cerrar el modal.
  const [refsCount,  setRefsCount]  = useState(initialRefsCount)
  // SHAs de candidatos que YA se guardaron en esta apertura del modal
  // — sirve para tachar visualmente el botón "Guardar" en sus tarjetas
  // sin tener que volver a llamar al endpoint find-replacements.
  const [savedCandidateUrls, setSavedCandidateUrls] = useState<Set<string>>(new Set())
  // Bump para forzar re-fetch ignorando caché (botón "refrescar")
  const [refreshTick, setRefreshTick] = useState(0)

  // ── Búsqueda — se dispara al cambiar de tab o al refrescar ─────────
  useEffect(() => {
    let cancelled = false
    const set = providerSet
    const run = async () => {
      // 1. Intento de caché (skip si venimos de refrescar)
      if (refreshTick === 0) {
        const cached = readCache(sha, set)
        if (cached?.candidates) {
          setKeyword(cached.keyword ?? "")
          setCandidates(cached.candidates)
          setProviders(cached.providersUsed ?? [])
          setError(cached.error ?? null)
          setFromCache(true)
          setLoading(false)
          return
        }
      }

      // 2. Hit de red
      setFromCache(false)
      setLoading(true)
      setError(null)
      try {
        const res = await fetch("/api/admin/images-bank/find-replacements", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ sha, max: 12, providerSet: set }),
        })
        const data = (await res.json()) as FindRepResponse
        if (cancelled) return
        if (!res.ok || !data.ok) {
          setError(data.error ?? `HTTP ${res.status}`)
          setCandidates([])
          setProviders([])
          setLoading(false)
          return
        }
        setKeyword(data.keyword ?? "")
        setCandidates(data.candidates ?? [])
        setProviders(data.providersUsed ?? [])
        setLoading(false)
        // 3. Guardar en caché para que la próxima apertura sea instantánea
        writeCache(sha, set, data)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [sha, providerSet, refreshTick])

  // Invalida la caché del tab actual y re-fetchea desde la red. Útil si
  // los stock APIs publicaron resultados nuevos o si el admin quiere
  // gastar otra query de SerpAPI a posta.
  function handleRefresh() {
    clearCache(sha, providerSet)
    setRefreshTick((n) => n + 1)
  }

  // ── Bloquear scroll del body mientras el modal está abierto ──────
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = prev }
  }, [])

  // ── Save reference handler ────────────────────────────────────────
  // Descarga el candidato, lo sube a R2 con su SHA como filename (sin
  // tocar Question), y registra el vínculo en alternative_references.json.
  // El clasificador lo recogerá en su siguiente run y lo etiquetará.
  async function handleSave(candidate: Candidate) {
    if (saving) return
    setSaving(candidate.url)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch("/api/admin/images-bank/save-reference", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          originalSha:  sha,
          candidateUrl: candidate.url,
          sourceUrl:    candidate.sourceUrl,
          provider:     candidate.provider,
          attribution:  candidate.attribution,
        }),
      })
      const data = (await res.json()) as SaveReferenceResponse
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`)
        setSaving(null)
        return
      }
      setSavedCandidateUrls((prev) => new Set([...prev, candidate.url]))
      if (typeof data.totalForOriginal === "number") setRefsCount(data.totalForOriginal)
      setSuccess(
        data.dedup
          ? `Ya estaba guardada — refs totales: ${data.totalForOriginal ?? refsCount}`
          : `Guardada ✓ SHA ${data.newSha?.slice(0, 10)}… · refs: ${data.totalForOriginal ?? refsCount + 1}`,
      )
      setSaving(null)
      // No cerramos el modal — el admin probablemente quiere guardar varias
      // referencias para el mismo SHA en una sola apertura. Que cierre él.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(null)
    }
  }

  // Refresca la página padre al cerrar SOLO si se guardaron refs nuevas
  // (la página padre relee meta/alternative_references.json para repintar
  // los badges de los demás tiles si comparten alguna ref con éste).
  function handleClose() {
    if (savedCandidateUrls.size > 0) router.refresh()
    onClose()
  }

  // ── Tag confident principal como contexto visual ─────────────────
  const topConfidentTag = currentTags?.find((t) => t.confident)?.tag
                       ?? currentTags?.[0]?.tag
                       ?? "(sin tag)"

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
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
            flexDirection:  "column",
            padding:        "14px 22px",
            borderBottom:   "1px solid var(--slate-200)",
            background:     "var(--slate-50, #f8fafc)",
            position:       "sticky",
            top:            0,
            zIndex:         1,
            gap:            12,
          }}
        >
          {/* Fila 1: título + cerrar */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
                <Search size={16} />
                Buscar referencias visuales
                {refsCount > 0 && (
                  <span
                    title="Referencias alternativas ya descargadas para esta imagen"
                    style={{
                      display:      "inline-flex",
                      alignItems:   "center",
                      gap:          4,
                      padding:      "2px 8px",
                      background:   "var(--indigo-600, #6366f1)",
                      color:        "white",
                      borderRadius: 999,
                      fontSize:     11,
                      fontWeight:   800,
                    }}
                  >
                    {refsCount} refs
                  </span>
                )}
              </h2>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--slate-500)" }}>
                SHA: <code>{sha.slice(0, 12)}…</code> · Tag principal: <strong>{topConfidentTag}</strong>
                {/* En modo Lens la búsqueda es VISUAL (reverse image),
                    no por palabra clave — mostramos algo más claro que
                    "Keyword:" para no confundir. */}
                {providerSet === "google" ? (
                  <>
                    {" · "}Modo: <strong>visual (reverse image)</strong>
                  </>
                ) : keyword ? (
                  <>
                    {" · "}Keyword: <strong>{keyword}</strong>
                  </>
                ) : null}
                {providers.length > 0 && (
                  <>
                    {" · "}Providers: <em>{providers.join(", ")}</em>
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Cerrar"
              style={{
                border: 0, background: "transparent", padding: 8,
                cursor: "pointer", color: "var(--slate-600)",
                borderRadius: 8, display: "inline-flex",
              }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Fila 2: tabs de provider set + estado de caché */}
          <div style={{
            display:        "flex",
            alignItems:     "center",
            justifyContent: "space-between",
            gap:            10,
            flexWrap:       "wrap",
          }}>
            <div role="tablist" aria-label="Tipo de búsqueda" style={{
              display: "inline-flex", padding: 3,
              background: "var(--slate-100)", borderRadius: 10,
              border: "1px solid var(--slate-200)",
            }}>
              <ProviderSetTab
                active={providerSet === "stock"}
                onClick={() => setProviderSet("stock")}
                icon={<Search size={12} />}
                label="Pexels + Pixabay"
                hint="Búsqueda por keyword (tag) · free"
              />
              <ProviderSetTab
                active={providerSet === "google"}
                onClick={() => setProviderSet("google")}
                icon={<Sparkles size={12} />}
                label="Google Lens"
                hint="Reverse image visual REAL · gasta 1 query SerpAPI"
                accent
              />
            </div>

            {/* Indicador de caché + botón refrescar */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}>
              {fromCache && !loading && (
                <span title="Resultados servidos desde sessionStorage — no se gastó cuota de API" style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "3px 8px", borderRadius: 999,
                  background: "rgba(59, 130, 246, 0.10)",
                  color: "var(--blue-700, #1d4ed8)",
                  fontWeight: 600,
                }}>
                  <Database size={11} />
                  caché
                </span>
              )}
              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading}
                title="Forzar búsqueda nueva (ignora caché)"
                aria-label="Refrescar búsqueda"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "5px 10px", border: "1px solid var(--slate-300)",
                  borderRadius: 8, background: "#fff",
                  color: "var(--slate-600)", cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.5 : 1,
                  fontSize: 11.5, fontWeight: 600,
                }}
              >
                <RefreshCw size={12} className={loading ? "spin" : undefined} />
                Refrescar
              </button>
            </div>
          </div>
        </header>

        {/* ── Body ─────────────────────────────────────────────────── */}
        <div style={{ padding: 22, flex: 1 }}>
          {/* Aviso de licencia — solo en modo Google Lens. Google no
              filtra por copyright, los matches pueden venir de sitios con
              derechos reservados. El admin tiene que verificar antes de
              reemplazar (botón "fuente" abre la página original). */}
          {providerSet === "google" && !loading && candidates.length > 0 && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              padding: "10px 12px", borderRadius: 8, marginBottom: 16,
              background: "rgba(245, 158, 11, 0.08)",
              border: "1px solid rgba(245, 158, 11, 0.25)",
              color: "var(--amber-d, #b45309)", fontSize: 12, lineHeight: 1.45,
            }}>
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                <strong>Google Lens no filtra por licencia.</strong> Los matches
                pueden tener copyright. Antes de reemplazar, abre la <em>fuente</em>{" "}
                del candidato y comprueba que se puede reusar. Para garantías
                automáticas usa el tab <strong>Pexels + Pixabay</strong>.
              </span>
            </div>
          )}

          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--slate-500)", padding: "20px 0" }}>
              <Loader2 size={16} className="spin" />
              {providerSet === "google"
                ? "Google Lens buscando matches visuales…"
                : `Buscando candidatos en ${providers.length > 0 ? providers.join(", ") : "los providers configurados"}…`}
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
                    Soluciones (en orden de calidad para DGT):
                    <br />• <strong>SerpAPI (Google Images, recomendado)</strong>:{" "}
                    <a href="https://serpapi.com/manage-api-key" target="_blank" rel="noopener noreferrer">
                      serpapi.com
                    </a>{" "}
                    → free tier 100 búsquedas/mes, después $50/mes. Calidad órdenes de
                    magnitud mejor que stock APIs porque indexa toda la web. Variable:{" "}
                    <code>SERPAPI_API_KEY</code>
                    <br />• Pixabay (stock, free 5000/h):{" "}
                    <a href="https://pixabay.com/accounts/register/" target="_blank" rel="noopener noreferrer">
                      pixabay.com
                    </a>{" "}
                    → <code>PIXABAY_API_KEY</code>
                    <br />• Pexels (stock, free 200/h):{" "}
                    <a href="https://www.pexels.com/api/" target="_blank" rel="noopener noreferrer">
                      pexels.com
                    </a>{" "}
                    → <code>PEXELS_API_KEY</code>
                    <br />• Unsplash (stock, free 50/h):{" "}
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
                  onSave={() => handleSave(c)}
                  saving={saving === c.url}
                  alreadySaved={savedCandidateUrls.has(c.url)}
                  disabled={Boolean(saving)}
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
          Las referencias guardadas se suben a R2 con su SHA y se quedan SIN
          etiquetar hasta que el clasificador (siguiente run) las procese.
          <strong> Question.imagen NO se modifica</strong> — solo amplía el banco
          con candidatos para que el clasificador escoja después.
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
  onSave,
  saving,
  alreadySaved,
  disabled,
}: {
  candidate:    Candidate
  onSave:       () => void
  saving:       boolean
  /** ya se guardó en esta apertura del modal → pinta el botón como "Guardada" */
  alreadySaved: boolean
  /** true mientras CUALQUIER candidato está siendo subido (evita concurrencia) */
  disabled:     boolean
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
            onClick={onSave}
            disabled={disabled || alreadySaved}
            title={alreadySaved
              ? "Ya guardada en este modal · puedes seguir guardando otras"
              : "Descargar y guardar en R2 como referencia visual de esta imagen"}
            style={{
              flex:           1,
              padding:        "6px 8px",
              border:         0,
              background:     saving
                                ? "var(--slate-400)"
                                : alreadySaved
                                  ? "var(--green, #16a34a)"
                                  : "var(--indigo-600, #6366f1)",
              color:          "#fff",
              borderRadius:   6,
              fontSize:       11.5,
              fontWeight:     700,
              cursor:         disabled || alreadySaved ? "default" : "pointer",
              opacity:        disabled && !saving && !alreadySaved ? 0.5 : 1,
              display:        "inline-flex",
              alignItems:     "center",
              justifyContent: "center",
              gap:            5,
              transition:     "background 0.15s",
            }}
          >
            {saving ? (
              <>
                <Loader2 size={11} className="spin" />
                Guardando…
              </>
            ) : alreadySaved ? (
              <>
                <Check size={11} />
                Guardada
              </>
            ) : (
              <>
                <Check size={11} />
                Guardar referencia
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

// ── Tab pill para el selector de provider set ───────────────────────
function ProviderSetTab({
  active,
  onClick,
  icon,
  label,
  hint,
  accent,
}: {
  active:   boolean
  onClick:  () => void
  icon:     React.ReactNode
  label:    string
  hint:     string
  /** El tab de "Google Lens" usa accent (indigo) para indicar opción premium */
  accent?:  boolean
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      title={hint}
      style={{
        display:        "inline-flex",
        alignItems:     "center",
        gap:            6,
        padding:        "6px 12px",
        border:         0,
        borderRadius:   8,
        background:     active
          ? (accent ? "var(--indigo-600, #6366f1)" : "#fff")
          : "transparent",
        color:          active
          ? (accent ? "#fff" : "var(--slate-900)")
          : "var(--slate-500)",
        fontSize:       12,
        fontWeight:     700,
        cursor:         "pointer",
        boxShadow:      active && !accent ? "0 1px 3px rgba(0,0,0,0.10)" : undefined,
        transition:     "background 0.15s, color 0.15s",
      }}
    >
      {icon}
      {label}
    </button>
  )
}
