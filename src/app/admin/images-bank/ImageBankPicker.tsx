"use client"

import { useEffect, useMemo, useState } from "react"
import {
  X,
  Library,
  ImageIcon,
  ImageOff,
  Tag as TagIcon,
  EyeOff,
  Loader2,
  AlertCircle,
} from "lucide-react"
import { LazyTileImage } from "./LazyTileImage"
import { CATEGORIES, LABEL_METADATA, isLabelNew, type Category } from "./labelMetadata"
import {
  QUALITY_TIERS,
  tierOf,
  effectiveScore,
  categoryHeaderStyle,
  groupByDateBucket,
  FALLBACK_IMAGE_DATE_MS,
  CONFIRMED_TAG_MIN_SCORE,
  isImageNew,
  type QualityTier,
  type GridSort,
  type BankApiPayload,
  type DisplayEntry,
} from "./lib"
import { FilterPill, QualityPill, SortToggle, SidebarHeader, DateDivider, QuestionsListButton, NewImageBadge, SwipeableImageTile } from "./BankUi"

interface PickerProps {
  open:     boolean
  onClose:  () => void
  /** Llamado con el filename (basename, p.ej. "abc123.png") cuando el
   *  admin hace click sobre una tile. La modal NO se cierra sola —
   *  el wrapper (ImageBankPickerButton) lo hace en su own onSelect. */
  onSelect: (filename: string) => void
  /**
   * Habilita el swipe Tinder "No es / Sí es" en las tiles. Solo para
   * roles con permiso de escritura sobre el banco (admin). El endpoint
   * ya está protegido con requireAdmin(), pero conviene esconder la
   * UI también para roles de solo lectura futuros (p.ej. "autoescuela").
   * Por defecto false — hay que habilitarlo explícitamente.
   */
  canWriteTagFeedback?: boolean
}

/**
 * Modal full-screen para BUSCAR una imagen en el banco clasificado y
 * seleccionarla (típicamente para asignarla a una pregunta).
 *
 * Reutiliza el mismo modelo de filtros que /admin/images-bank (sidebar
 * con filtros especiales + calidad + por tag agrupado por categoría),
 * pero con estado LOCAL (no URL params) porque es un modal.
 *
 * Datos: fetch lazy a /api/admin/images-bank/data en la primera apertura.
 * El payload no se invalida — si el dev re-corre el classifier mientras
 * la página está montada, hay que cerrar y reabrir para refrescar.
 *
 * Tiles: LazyTileImage en modo picker (onClick = onSelect del prop).
 * Sigue habiendo zoom via el icono flotante en la esquina del tile.
 */
export function ImageBankPicker({ open, onClose, onSelect, canWriteTagFeedback = false }: PickerProps) {
  const [data,  setData]  = useState<BankApiPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  // `loading` se deriva del estado — evita un render extra y satisface
  // la regla react-hooks/set-state-in-effect (sin setState síncrono
  // dentro del effect).
  const loading = open && data === null && error === null

  // Filtros locales — mismos que /admin/images-bank pero en useState
  const [tagFilter,      setTagFilter]      = useState<string | undefined>(undefined)
  const [untaggedFilter, setUntaggedFilter] = useState(false)
  const [lowConfFilter,  setLowConfFilter]  = useState(false)
  const [withTagsFilter, setWithTagsFilter] = useState(false)
  const [qualityFilter,  setQualityFilter]  = useState<QualityTier | null>(null)
  const [sortDir,        setSortDir]        = useState<"asc" | "desc">("desc")
  // gridSort es COMPLEMENTARIO a los demás filtros: cuando es "added"
  // o "tagged" sobreescribe el orden del grid + activa divisores por
  // fecha. No altera QUÉ imágenes pasan los filtros.
  const [gridSort,       setGridSort]       = useState<GridSort>("auto")

  // Lazy fetch al primer open. Si hubo error previo, cerrar+reabrir
  // limpia el error (ver `handleClose` abajo) y vuelve a intentar.
  useEffect(() => {
    if (!open || data || error) return
    let cancelled = false
    fetch("/api/admin/images-bank/data", { cache: "no-store" })
      .then(async (r) => {
        const json = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(json?.error || `HTTP ${r.status}`)
        return json as BankApiPayload
      })
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => { cancelled = true }
  }, [open, data, error])

  // Wrapper de close — limpia el error para que el próximo open
  // reintente el fetch (la data sí se cachea).
  const handleClose = () => {
    setError(null)
    onClose()
  }

  // ESC para cerrar + bloqueo scroll body mientras abierto
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose()
    }
    window.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
    // handleClose se redefine cada render pero captura setError + onClose
    // estables — no necesitamos re-suscribir el listener por su identidad.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose])

  // ── Merge metadata estática (labelMetadata.ts) + descubiertos (Gemini) ──
  const labelEs = (id: string): string => {
    if (LABEL_METADATA[id]) return LABEL_METADATA[id].displayEs
    const discovered = data?.discovered?.labels.find((l) => l.id === id)
    return discovered?.displayEs ?? id
  }
  const labelCategory = (id: string): Category => {
    if (LABEL_METADATA[id]) return LABEL_METADATA[id].category
    const discovered = data?.discovered?.labels.find((l) => l.id === id)
    if (discovered && (CATEGORIES as readonly string[]).includes(discovered.category)) {
      return discovered.category as Category
    }
    return "Especiales"
  }
  /** discoveredAt por id — usado por `isLabelNew()` para los labels que
   *  vienen de Gemini/Groq (no de la metadata estática). */
  const discoveredAtById = (id: string): string | undefined =>
    data?.discovered?.labels.find((l) => l.id === id)?.discoveredAt

  // ── Build entries + aplicar filtros (memoizado) ──
  const view = useMemo(() => {
    if (!data) {
      return {
        entries:        [] as DisplayEntry[],
        filterLabel:    "Todas",
        total:          0,
        noTagsCount:    0,
        noConfCount:    0,
        withTagsCount:  0,
        qualityCounts:  { very_high: 0, high: 0, medium: 0, low: 0, very_low: 0 } as Record<QualityTier, number>,
        tagsByCategory: new Map<Category, Array<{ tag: string; count: number; confident: number }>>(),
        orphans:        [] as Array<[string, number]>,
        confidentTags:  {} as Record<string, number>,
      }
    }
    const classification = data.classification
    const audit    = data.audit
    const mtimeMap = data.existingFilesMtime ?? {}

    const shaToAudit = new Map(audit.groups.map((g) => [g.sha256, g]))

    // Mismas reglas que page.tsx: aplicar exclusiones + boost de
    // confirmaciones manuales del admin (swipe Tinder). Vienen del
    // payload del endpoint /data — el backend ya las lee del JSON.
    // Convertimos los Record<sha, string[]> a Map<sha, Set<string>>
    // para lookups O(1) durante el map de entries.
    const exclusionsMap = new Map<string, Set<string>>()
    for (const [sha, tags] of Object.entries(data.tagExclusions ?? {})) {
      if (Array.isArray(tags) && tags.length > 0) {
        exclusionsMap.set(sha, new Set(tags))
      }
    }
    const confirmationsMap = new Map<string, Set<string>>()
    for (const [sha, tags] of Object.entries(data.tagConfirmations ?? {})) {
      if (Array.isArray(tags) && tags.length > 0) {
        confirmationsMap.set(sha, new Set(tags))
      }
    }

    let entries: DisplayEntry[] = Object.entries(classification.images).map(([sha, info]) => {
      const a = shaToAudit.get(sha)
      const maxQuestionId = a && a.questions.length > 0
        ? Math.max(...a.questions.map((q) => q.id))
        : 0
      // addedAt = mtime del archivo en disco (cuándo se agregó al banco).
      const addedAt = mtimeMap[info.filename] ?? null
      // taggedAt = ISO del classifier. null hasta que se re-corra el
      // classifier tras el upgrade del feature.
      const taggedAtMs = info.taggedAt ? Date.parse(info.taggedAt) : NaN
      const taggedAt   = Number.isFinite(taggedAtMs) ? taggedAtMs : null
      // Aplicar exclusiones (filtrar tag) + confirmaciones (boost score)
      // — mismo patrón que page.tsx para reflejar las acciones del
      // admin en el picker sin esperar al próximo run del classifier.
      const exclusions    = exclusionsMap.get(sha)
      const confirmations = confirmationsMap.get(sha)
      let tagsFiltered = exclusions
        ? info.tags.filter((t) => !exclusions.has(t.tag))
        : info.tags
      if (confirmations) {
        tagsFiltered = tagsFiltered.map((t) =>
          confirmations.has(t.tag) && t.score < CONFIRMED_TAG_MIN_SCORE
            ? { ...t, score: CONFIRMED_TAG_MIN_SCORE }
            : t,
        )
      }
      return {
        sha,
        filename:      info.filename,
        tags:          tagsFiltered,
        maxScore:      tagsFiltered.reduce((m, t) => Math.max(m, t.score), 0),
        questionCount: a?.questionCount ?? 0,
        questions:     (a?.questions ?? []).map((q) => ({
          id:         q.id,
          externalId: q.externalId,
          codigoTema: q.codigoTema,
        })),
        maxQuestionId,
        addedAt,
        taggedAt,
      }
    })

    let filterLabel = "Todas"
    if (untaggedFilter) {
      entries     = entries.filter((e) => e.tags.length === 0)
      filterLabel = "Sin ningún tag"
    } else if (lowConfFilter) {
      entries     = entries.filter((e) => !e.tags.some((t) => t.confident))
      filterLabel = "Sin tag confident"
    } else if (withTagsFilter) {
      entries     = entries.filter((e) => e.tags.length > 0)
      filterLabel = "Con tags"
    } else if (tagFilter) {
      entries     = entries.filter((e) => e.tags.some((t) => t.tag === tagFilter))
      filterLabel = `Tag: ${labelEs(tagFilter)}`
    }

    // Counts de calidad ANTES de filtrar por calidad
    const qualityCounts: Record<QualityTier, number> = {
      very_high: 0, high: 0, medium: 0, low: 0, very_low: 0,
    }
    for (const e of entries) {
      const t = tierOf(effectiveScore(e, tagFilter))
      if (t) qualityCounts[t]++
    }

    if (qualityFilter) {
      const tier = QUALITY_TIERS.find((t) => t.id === qualityFilter)!
      entries = entries.filter((e) => {
        const s = effectiveScore(e, tagFilter)
        return s >= tier.min && s < tier.max
      })
      filterLabel += ` · ${tier.label}`
    }

    // Sort. "tagged" sobreescribe por taggedAt desc. "auto" aplica el
    // orden intrínseco — se preserva DENTRO de cada bucket cuando se
    // agrupa luego por addedAt.
    if (gridSort === "tagged") {
      entries.sort((a, b) => {
        const da  = a.taggedAt ?? FALLBACK_IMAGE_DATE_MS
        const dbb = b.taggedAt ?? FALLBACK_IMAGE_DATE_MS
        if (da !== dbb) return dbb - da
        return b.maxQuestionId - a.maxQuestionId
      })
    } else if (untaggedFilter || lowConfFilter) {
      entries.sort((a, b) => a.maxScore - b.maxScore)
    } else if (tagFilter) {
      entries.sort((a, b) => {
        const aScore = a.tags.find((t) => t.tag === tagFilter)?.score ?? 0
        const bScore = b.tags.find((t) => t.tag === tagFilter)?.score ?? 0
        return bScore - aScore
      })
    } else {
      entries.sort((a, b) => b.questionCount - a.questionCount)
    }

    // Stats globales (sobre el dataset completo, no sobre entries filtrados)
    const total          = classification.imagesProcessed
    const noTagsCount    = classification.stats?.imagesWithoutTags ?? 0
    const noConfCount    = classification.stats?.imagesWithoutConfidentTag ?? 0
    const withTagsCount  = total - noTagsCount
    const tagCounts      = classification.stats?.tagCounts ?? {}
    const confidentTags  = classification.stats?.confidentTagCounts ?? {}

    const tagsByCategory = new Map<Category, Array<{ tag: string; count: number; confident: number }>>()
    for (const [tag, count] of Object.entries(tagCounts)) {
      const cat = labelCategory(tag)
      if (!tagsByCategory.has(cat)) tagsByCategory.set(cat, [])
      tagsByCategory.get(cat)!.push({ tag, count, confident: confidentTags[tag] ?? 0 })
    }
    for (const arr of tagsByCategory.values()) {
      arr.sort((a, b) => sortDir === "asc" ? a.count - b.count : b.count - a.count)
    }

    const known = new Set<string>(
      Array.from(tagsByCategory.values()).flat().map((t) => t.tag)
    )
    const orphans = Object.entries(tagCounts)
      .filter(([t]) => !known.has(t))
      .sort((a, b) => sortDir === "asc" ? a[1] - b[1] : b[1] - a[1])

    return {
      entries, filterLabel, total, noTagsCount, noConfCount, withTagsCount,
      qualityCounts, tagsByCategory, orphans, confidentTags,
    }
    // labelCategory cierra sobre data.discovered, así que data ya es dependencia
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tagFilter, untaggedFilter, lowConfFilter, withTagsFilter, qualityFilter, sortDir, gridSort])

  function resetAllFilters() {
    setTagFilter(undefined)
    setUntaggedFilter(false)
    setLowConfFilter(false)
    setWithTagsFilter(false)
    setQualityFilter(null)
  }

  function pickFilter(opts: {
    tag?:      string | undefined
    untagged?: boolean
    lowconf?:  boolean
    tagged?:   boolean
  }) {
    // Los 4 son mutuamente excluyentes
    setTagFilter(opts.tag)
    setUntaggedFilter(!!opts.untagged)
    setLowConfFilter(!!opts.lowconf)
    setWithTagsFilter(!!opts.tagged)
    // No tocamos qualityFilter — se queda como filtro secundario
  }

  // No montamos nada si está cerrado (evita IntersectionObserver inútiles)
  if (!open) return null

  const filterIcon =
    untaggedFilter ? <ImageOff className="h-4 w-4" /> :
    lowConfFilter  ? <EyeOff   className="h-4 w-4" /> :
                     <TagIcon  className="h-4 w-4" />

  return (
    <div
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="Banco de imágenes — selecciona una imagen"
      style={{
        position:       "fixed",
        inset:          0,
        background:     "rgba(15, 23, 42, 0.78)",
        backdropFilter: "blur(4px)",
        zIndex:         9000,
        display:        "flex",
        alignItems:     "stretch",
        justifyContent: "center",
        padding:        24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background:    "#fff",
          borderRadius:  14,
          width:         "100%",
          maxWidth:      1400,
          maxHeight:     "100%",
          display:       "flex",
          flexDirection: "column",
          overflow:      "hidden",
          boxShadow:     "0 30px 80px rgba(0,0,0,0.45)",
        }}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <header
          style={{
            display:        "flex",
            alignItems:     "center",
            justifyContent: "space-between",
            padding:        "14px 18px",
            borderBottom:   "1px solid var(--slate-200)",
            background:     "var(--slate-50, #f8fafc)",
            flexShrink:     0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ImageIcon className="h-5 w-5" style={{ color: "var(--orange-600)" }} />
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
              Banco de imágenes
            </h2>
            {data && (
              <span style={{ fontSize: 12, color: "var(--slate-500)" }}>
                · {view.entries.length.toLocaleString("es")} / {view.total.toLocaleString("es")} imágenes
                · {view.filterLabel}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Cerrar"
            style={{
              border:       0,
              background:   "transparent",
              padding:      6,
              borderRadius: 8,
              cursor:       "pointer",
              color:        "var(--slate-600)",
              display:      "inline-flex",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--slate-200)" }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* ── Body ───────────────────────────────────────────────────── */}
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {loading && (
            <div style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              flexDirection: "column", gap: 10, color: "var(--slate-500)", fontSize: 13,
            }}>
              <Loader2 className="h-6 w-6 animate-spin" />
              Cargando banco de imágenes…
            </div>
          )}

          {!loading && error && (
            <div style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              padding: 24,
            }}>
              <div style={{
                maxWidth: 520, padding: 18, borderRadius: 10,
                background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.25)",
                color: "var(--red-600)", fontSize: 13,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, marginBottom: 6 }}>
                  <AlertCircle className="h-4 w-4" />
                  No se pudo cargar el banco de imágenes
                </div>
                <div style={{ fontSize: 12.5, color: "var(--slate-700)" }}>{error}</div>
                <div style={{ fontSize: 11.5, color: "var(--slate-500)", marginTop: 8 }}>
                  ¿Has corrido <code>npm run images:audit-sha</code> y <code>npm run images:classify</code>?
                </div>
              </div>
            </div>
          )}

          {!loading && !error && data && (
            <>
              {/* Sidebar de filtros (sticky internal scroll) */}
              <aside
                style={{
                  width:        260,
                  flexShrink:   0,
                  overflowY:    "auto",
                  borderRight:  "1px solid var(--slate-100)",
                  padding:      "14px 12px 18px",
                  background:   "#fff",
                }}
              >
                {/* Filtros especiales */}
                <SidebarHeader>Filtros especiales</SidebarHeader>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 16 }}>
                  <FilterPill
                    label="Todas"
                    count={view.total}
                    active={!untaggedFilter && !lowConfFilter && !withTagsFilter && !tagFilter && !qualityFilter}
                    onClick={() => { resetAllFilters() }}
                  />
                  <FilterPill
                    label="Sin tag"
                    count={view.noTagsCount}
                    active={untaggedFilter}
                    color="warn"
                    icon={<ImageOff className="h-3 w-3" />}
                    onClick={() => pickFilter({ untagged: true })}
                  />
                  <FilterPill
                    label="Sin confident"
                    count={view.noConfCount}
                    active={lowConfFilter}
                    color="warn"
                    icon={<EyeOff className="h-3 w-3" />}
                    onClick={() => pickFilter({ lowconf: true })}
                  />
                  <FilterPill
                    label="Con tags"
                    count={view.withTagsCount}
                    active={withTagsFilter}
                    color="ok"
                    icon={<TagIcon className="h-3 w-3" />}
                    onClick={() => pickFilter({ tagged: true })}
                  />
                </div>

                {/* Calidad */}
                <SidebarHeader>Calidad</SidebarHeader>
                <div style={{ fontSize: 10, color: "var(--slate-400)", marginBottom: 6, lineHeight: 1.3 }}>
                  {tagFilter ? "Score del tag actual" : "Max score por imagen"}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
                  <QualityPill
                    label="Todas"
                    count={view.entries.length}
                    tierColor="var(--slate-100)"
                    active={!qualityFilter}
                    showDot={false}
                    onClick={() => setQualityFilter(null)}
                  />
                  {QUALITY_TIERS.map((t) => (
                    <QualityPill
                      key={t.id}
                      label={t.label}
                      count={view.qualityCounts[t.id]}
                      tierColor={t.color}
                      active={qualityFilter === t.id}
                      showDot
                      title={`${t.min.toFixed(2)} ≤ score < ${t.max.toFixed(2)}`}
                      onClick={() => setQualityFilter(t.id)}
                    />
                  ))}
                </div>

                {/* Ordenar grid — siempre con divisores por fecha */}
                <SidebarHeader>Ordenar grid</SidebarHeader>
                <div style={{ fontSize: 10, color: "var(--slate-400)", marginBottom: 8, lineHeight: 1.3 }}>
                  Siempre divisores por fecha (Hoy / Esta semana / …)
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
                  <SortToggle
                    active={gridSort === "auto"}
                    label="Por defecto"
                    title="Orden intrínseco dentro de cada bucket (agrupado por mtime del archivo)"
                    onClick={() => setGridSort("auto")}
                  />
                  <SortToggle
                    active={gridSort === "tagged"}
                    label="🏷️ Nuevas tagueadas"
                    title="Ordena por fecha de tagging del classifier (útil tras añadir labels)"
                    onClick={() => setGridSort("tagged")}
                  />
                </div>

                {/* Sort toggle (orden de los pills de tag, no del grid) */}
                <SidebarHeader>Por tag</SidebarHeader>
                <div style={{ display: "flex", gap: 3, marginBottom: 8 }}>
                  <SortToggle
                    active={sortDir === "desc"}
                    label="↓ más"
                    title="Más usadas primero"
                    onClick={() => setSortDir("desc")}
                  />
                  <SortToggle
                    active={sortDir === "asc"}
                    label="↑ menos"
                    title="Menos usadas primero"
                    onClick={() => setSortDir("asc")}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {CATEGORIES.map((cat) => {
                    const tags = view.tagsByCategory.get(cat) ?? []
                    if (tags.length === 0) return null
                    return (
                      <div key={cat}>
                        <div style={categoryHeaderStyle}>{cat}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {tags.map(({ tag, count, confident }) => (
                            <FilterPill
                              key={tag}
                              label={labelEs(tag)}
                              count={count}
                              subCount={confident}
                              active={tagFilter === tag}
                              isNew={isLabelNew(tag, discoveredAtById(tag))}
                              onClick={() => pickFilter({ tag })}
                            />
                          ))}
                        </div>
                      </div>
                    )
                  })}

                  {view.orphans.length > 0 && (
                    <div>
                      <div style={categoryHeaderStyle}>Otros (sin metadata)</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {view.orphans.map(([tag, count]) => (
                          <FilterPill
                            key={tag}
                            label={tag}
                            count={count}
                            subCount={view.confidentTags[tag] ?? 0}
                            active={tagFilter === tag}
                            isNew={isLabelNew(tag, discoveredAtById(tag))}
                            onClick={() => pickFilter({ tag })}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </aside>

              {/* Main: header + grid */}
              <main style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "14px 16px 20px" }}>
                {/* Sub-header con instrucción + filtro actual */}
                <div style={{
                  display:        "flex",
                  alignItems:     "center",
                  justifyContent: "space-between",
                  marginBottom:   12,
                  fontSize:       13,
                  color:          "var(--slate-700)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                    {filterIcon}
                    {view.filterLabel}
                    <span style={{ color: "var(--slate-500)", fontWeight: 400 }}>
                      · {view.entries.length.toLocaleString("es")} imágenes
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--slate-500)" }}>
                    Click sobre una imagen para seleccionarla
                  </div>
                </div>

                {view.entries.length === 0 ? (
                  <div style={{
                    padding: 28, textAlign: "center", color: "var(--slate-500)",
                    border: "1px dashed var(--slate-200)", borderRadius: 10,
                    background: "var(--slate-50, #f8fafc)",
                  }}>
                    No hay imágenes que coincidan con este filtro.
                  </div>
                ) : (
                  // Siempre agrupamos por bucket temporal con divisores:
                  //   - "auto"   → por addedAt (mtime), orden intrínseco
                  //                preservado dentro de cada bucket
                  //   - "tagged" → por taggedAt, ordenado por fecha desc
                  <>
                    {groupByDateBucket(
                      view.entries,
                      gridSort === "tagged"
                        ? (e) => e.taggedAt
                        : (e) => e.addedAt,
                    ).map((group) => (
                      <div key={group.bucket}>
                        <DateDivider label={group.label} sub={group.sub} count={group.entries.length} />
                        <div
                          style={{
                            display:             "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                            gap:                 10,
                          }}
                        >
                          {group.entries.map((entry) => {
                            const pickerTile = (
                              <PickerTile
                                key={entry.sha}
                                entry={entry}
                                existsInDisk={true}
                                currentTag={tagFilter}
                                getDisplay={labelEs}
                                onSelect={() => onSelect(entry.filename)}
                                onTagClick={(tag) => {
                                  // Toggle: si clickeo el tag activo, lo
                                  // quito; si no, lo aplico. pickFilter ya
                                  // hace mutex con los demás base filters.
                                  pickFilter({ tag: tag === tagFilter ? undefined : tag })
                                }}
                              />
                            )
                            // Swipe "No es" / "Sí es": solo si hay tagFilter
                            // Y el rol tiene permiso de escritura. El endpoint
                            // ya requiere admin, pero ocultamos la UI para
                            // roles futuros de solo lectura (p.ej. autoescuela).
                            if (tagFilter && canWriteTagFeedback) {
                              return (
                                <SwipeableImageTile
                                  key={`${entry.sha}-${tagFilter}`}
                                  entry={entry}
                                  tag={tagFilter}
                                  tagDisplay={labelEs(tagFilter)}
                                >
                                  {pickerTile}
                                </SwipeableImageTile>
                              )
                            }
                            return pickerTile
                          })}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </main>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// FilterPill / QualityPill / SortToggle / SidebarHeader viven en
// ./BankUi.tsx — compartidos con /admin/images-bank. Styles helpers
// (qualityPillStyle, sortTogglePillStyle, categoryHeaderStyle) en ./lib.ts.
// Aquí solo queda el tile específico del picker (con onSelect).

function PickerTile({ entry, currentTag, getDisplay, onSelect, onTagClick }: {
  entry:        DisplayEntry
  existsInDisk: boolean  // reservado para futuras mejoras (gris si missing)
  currentTag:   string | undefined
  getDisplay:   (id: string) => string
  onSelect:     () => void
  /** Click sobre un tag pill: cambia el filtro local del picker.
   *  El padre decide la semántica de toggle (si tag === currentTag,
   *  lo quita; si no, lo aplica). El onClick del pill hace
   *  stopPropagation para no disparar el onSelect del tile. */
  onTagClick:   (tag: string) => void
}) {
  // Misma URL que /admin/images-bank: /images/<sha>.<ext>. El picker
  // SOLO funciona en local porque las imágenes únicas no van a prod
  // (gitignored). Es un tool de DEV.
  const imgSrc = `/images/${entry.filename}`

  return (
    <div
      style={{
        background:    "#fff",
        border:        "1px solid var(--slate-200)",
        borderRadius:  10,
        overflow:      "hidden",
        display:       "flex",
        flexDirection: "column",
        position:      "relative",
        height:        "100%",
      }}
    >
      {isImageNew(entry.addedAt) && <NewImageBadge size="sm" />}
      <LazyTileImage src={imgSrc} alt={entry.sha.slice(0, 8)} onClick={onSelect} />

      <div style={{ padding: 6, fontSize: 10.5, display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
        <div style={{ color: "var(--slate-600)", fontSize: 10 }}>
          <QuestionsListButton questions={entry.questions} />
        </div>

        {entry.tags.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {entry.tags.slice(0, 2).map((t) => {
              const isFiltered = currentTag === t.tag
              return (
                <button
                  key={t.tag}
                  type="button"
                  onClick={(e) => {
                    // stopPropagation crucial: el wrapper del tile NO
                    // tiene onClick directo pero por defensiva.
                    e.stopPropagation()
                    onTagClick(t.tag)
                  }}
                  title={isFiltered ? `Quitar filtro: ${t.tag}` : `Filtrar por: ${t.tag} · ${t.score.toFixed(2)}`}
                  style={{
                    display:        "flex",
                    justifyContent: "space-between",
                    alignItems:     "center",
                    fontSize:       9.5,
                    padding:        "1px 5px",
                    borderRadius:   3,
                    border:         0,
                    cursor:         "pointer",
                    textAlign:      "left",
                    width:          "100%",
                    background:     isFiltered
                      ? "rgba(234, 88, 12, 0.18)"
                      : t.confident
                      ? "rgba(34, 197, 94, 0.12)"
                      : "var(--slate-100)",
                    color: isFiltered
                      ? "var(--orange-600)"
                      : t.confident
                      ? "var(--green-d)"
                      : "var(--slate-500)",
                    fontWeight: isFiltered ? 700 : 400,
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {getDisplay(t.tag)}
                  </span>
                  <span className="font-mono-tabular" style={{ fontSize: 9, marginLeft: 4, flexShrink: 0 }}>
                    {t.score.toFixed(2)}
                  </span>
                </button>
              )
            })}
            {entry.tags.length > 2 && (
              <div style={{ fontSize: 9, color: "var(--slate-400)", paddingLeft: 5 }}>
                +{entry.tags.length - 2} más
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Wrapper button (lo importan los forms de edición) ─────────────────

interface ButtonProps {
  onSelect: (filename: string) => void
  label?:   string
  /** Estilo del trigger. "primary" usa naranja como el botón principal,
   *  "ghost" un secundario más discreto para meter al lado de un input. */
  variant?: "primary" | "ghost"
  disabled?: boolean
  /** Pasa `canWriteTagFeedback` al picker — habilita el swipe Tinder
   *  para admins con permiso de escritura. */
  canWriteTagFeedback?: boolean
}

/**
 * Botón pre-cableado: maneja su propio open/close state y abre el modal
 * `ImageBankPicker`. Llama `onSelect(filename)` cuando el admin elige
 * una imagen y cierra el modal automáticamente.
 *
 * Uso típico:
 *   const [imagen, setImagen] = useState("...")
 *   <ImageBankPickerButton onSelect={(f) => setImagen(f)} />
 */
export function ImageBankPickerButton({
  onSelect,
  label               = "Buscar en banco",
  variant             = "ghost",
  disabled            = false,
  canWriteTagFeedback = false,
}: ButtonProps) {
  const [open, setOpen] = useState(false)

  const buttonStyle: React.CSSProperties = variant === "primary"
    ? {
        padding:      "8px 14px",
        borderRadius: 8,
        border:       0,
        background:   "var(--orange-600)",
        color:        "white",
        fontWeight:   700,
        fontSize:     13,
        cursor:       disabled ? "not-allowed" : "pointer",
        opacity:      disabled ? 0.5 : 1,
        display:      "inline-flex",
        alignItems:   "center",
        gap:          6,
      }
    : {
        padding:      "8px 12px",
        borderRadius: 8,
        border:       "1.5px solid var(--slate-200)",
        background:   "#fff",
        color:        "var(--slate-700)",
        fontWeight:   600,
        fontSize:     12.5,
        cursor:       disabled ? "not-allowed" : "pointer",
        opacity:      disabled ? 0.5 : 1,
        display:      "inline-flex",
        alignItems:   "center",
        gap:          6,
      }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        style={buttonStyle}
      >
        <Library className="h-3.5 w-3.5" />
        {label}
      </button>
      <ImageBankPicker
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(filename) => {
          onSelect(filename)
          setOpen(false)
        }}
        canWriteTagFeedback={canWriteTagFeedback}
      />
    </>
  )
}
