import { promises as fs } from "node:fs"
import path from "node:path"
import Link from "next/link"
import { getJsonFromR2, R2_META_KEYS } from "@/lib/imagesBankR2"
import {
  ChevronLeft,
  ImageIcon,
  ImageOff,
  Tag as TagIcon,
  EyeOff,
  AlertCircle,
  X,
  Check,
} from "lucide-react"
import { LazyTileImage } from "./LazyTileImage"
import { imageUrl } from "@/lib/imageUrl"
import { CATEGORIES, LABEL_METADATA, isLabelNew, type Category, type LabelMetadata } from "./labelMetadata"
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
  type ClassificationData,
  type ShaAuditGroup,
  type ShaAuditData,
  type DisplayEntry,
} from "./lib"
import { FilterPill, QualityPill, SortToggle, SidebarHeader, DateDivider, QuestionsListButton, NewImageBadge, SwipeableImageTile, ScrollToHashTarget, CardHashUpdater, TagSearchInput } from "./BankUi"
import { FindReplacementsButton } from "./FindReplacementsModal"

export const dynamic = "force-dynamic"

/**
 * Vista admin del banco de imágenes clasificadas por SigLIP.
 *
 * Lee los JSONs del banco desde R2 (bucket `meta/` prefix):
 *   - meta/sha-audit.json          → SHA → preguntas que lo usan
 *   - meta/classification.json     → SHA → tags + scores
 *   - meta/discovered_labels.json  → labels descubiertos por Gemini/Groq
 *   - meta/tag_exclusions.json     → swipes "No es" del admin
 *   - meta/tag_confirmations.json  → swipes "Sí es" del admin
 *
 * El classifier corre en LOCAL y escribe en tools/image-audit/. Después,
 * `npm run images:upload-metadata` empuja esos JSONs a R2 → prod los lee.
 *
 * Permite filtrar por tag, ver las que no tienen tags, las que no tienen
 * tag confident, etc. — diseñado para iterar el vocabulario de LABELS
 * en classify_siglip.py:
 *
 *   1. Abre /admin/images-bank?untagged=1
 *   2. Identifica patrones visuales que no estamos capturando
 *   3. Edita LABELS, re-corre clasificador
 *   4. Vuelve a esta vista
 *
 * Las imágenes vienen de `public/images/sanitize/<sha>.{ext}`, que es
 * gitignored y solo existe en local — esta página NO funciona en prod
 * (mostrará iconos de "missing file"). Es intencional: es una herramienta
 * de DESARROLLO, no de producción.
 */

// Tipos (ClassificationData, ShaAuditData, DisplayEntry…) y utilidades
// (QUALITY_TIERS, tierOf, effectiveScore) viven en ./lib.ts compartidos
// con ImageBankPicker.tsx — un único sitio donde tocarlos.

// Las imágenes únicas viven directamente en public/images/ (las moviste
// desde public/images/sanitize/). El filename en classification.json es
// solo el basename (<sha>.ext), sin path — funciona en cualquier ruta.
// En prod (Vercel) este dir no existe — el sort "más recientes" cae a 0
// y se confía en addedAt del classification.json si lo hay.
const IMAGES_DIR = path.join(process.cwd(), "public", "images")

interface PageProps {
  searchParams: Promise<{
    tag?:       string
    untagged?:  string
    lowconf?:   string
    tagged?:    string  // inverso de untagged: imgs CON al menos 1 tag (cualquier score)
    quality?:   string  // QualityTier id, ver QUALITY_TIERS
    sort?:      string  // "asc" | "desc" (default desc) — orden de las pills por count
    gridsort?:  string  // "most_recent" sobreescribe el orden del grid; ausente = auto
  }>
}

async function loadData(): Promise<{
  classification: ClassificationData | null
  audit:          ShaAuditData | null
  error:          string | null
}> {
  try {
    const [classification, audit] = await Promise.all([
      getJsonFromR2<ClassificationData>(R2_META_KEYS.classification),
      getJsonFromR2<ShaAuditData>(R2_META_KEYS.shaAudit),
    ])
    return {
      classification,
      audit,
      error: classification && audit ? null : "Faltan classification.json o sha-audit.json en R2",
    }
  } catch (err) {
    return {
      classification: null,
      audit:          null,
      error:          err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Carga los labels descubiertos por Gemini al vuelo (discovered_labels.json).
 * Esos labels NO viven en labelMetadata.ts (que es estático) — se generan
 * dinámicamente cuando el classifier corre con GEMINI_API_KEY. Los mergeamos
 * en runtime para que la UI muestre su display español y categoría sin
 * editar código.
 */
async function loadDiscoveredLabels(): Promise<Record<string, LabelMetadata & { discoveredAt?: string }>> {
  try {
    const data = await getJsonFromR2<{
      labels: { id: string; displayEs: string; category: string; discoveredAt?: string }[]
    }>(R2_META_KEYS.discoveredLabels)
    if (!data) return {}
    const map: Record<string, LabelMetadata & { discoveredAt?: string }> = {}
    for (const l of data.labels ?? []) {
      // Validar que category sea una conocida; si no, "Especiales"
      const cat = (CATEGORIES as readonly string[]).includes(l.category)
        ? (l.category as Category)
        : ("Especiales" as Category)
      map[l.id] = { displayEs: l.displayEs, category: cat, discoveredAt: l.discoveredAt }
    }
    return map
  } catch {
    return {}
  }
}

/**
 * Helper genérico para cargar JSONs sha → tags. Mismo shape para
 * tag_exclusions.json (mapKey="exclusions") y tag_confirmations.json
 * (mapKey="confirmations").
 *
 * Devuelve Map vacío si el archivo no existe o está vacío — el banco
 * arranca sin exclusiones/confirmaciones; las añade el admin.
 */
async function loadShaTagMap(r2Key: string, mapKey: string): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>()
  try {
    const data = await getJsonFromR2<Record<string, unknown>>(r2Key)
    if (!data) return result
    const inner = data[mapKey]
    if (inner && typeof inner === "object") {
      for (const [sha, tags] of Object.entries(inner)) {
        if (Array.isArray(tags) && tags.length > 0) {
          result.set(sha, new Set(tags.filter((t): t is string => typeof t === "string")))
        }
      }
    }
  } catch {
    // No existe / JSON inválido → vacío
  }
  return result
}

/** Atajo para el caso más común (exclusiones). */
async function loadTagExclusions(): Promise<Map<string, Set<string>>> {
  return loadShaTagMap(R2_META_KEYS.tagExclusions, "exclusions")
}

/**
 * Carga meta/alternative_references.json y devuelve un Map<sha, count>
 * para que el tile pueda pintar el badge "X refs descargadas" junto a
 * la lupa. Si el JSON no existe (banco virgen, nadie guardó refs todavía)
 * devuelve Map vacío.
 */
async function loadReferenceCounts(): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  try {
    const data = await getJsonFromR2<{ references?: Record<string, unknown[]> }>(
      R2_META_KEYS.alternativeReferences,
    )
    if (!data?.references) return result
    for (const [sha, arr] of Object.entries(data.references)) {
      if (Array.isArray(arr) && arr.length > 0) result.set(sha, arr.length)
    }
  } catch {
    // No existe / JSON inválido → vacío
  }
  return result
}

/**
 * Lista los archivos físicos de public/images/ con su mtime (ms).
 * Devuelve un Map<filename, mtimeMs> para:
 *   1) detectar tiles missing (`!map.has(filename)`)
 *   2) feed del sort "Más recientes agregadas"
 *
 * Si la carpeta no existe (caso prod sin /public/images/) devuelve
 * un Map vacío.
 */
async function loadFilesMtime(): Promise<Map<string, number>> {
  let names: string[]
  try {
    names = await fs.readdir(IMAGES_DIR)
  } catch {
    return new Map()
  }
  const out = new Map<string, number>()
  await Promise.all(names.map(async (name) => {
    try {
      const st = await fs.stat(path.join(IMAGES_DIR, name))
      out.set(name, st.mtimeMs)
    } catch {
      // Archivo desapareció entre readdir y stat — ignoramos.
    }
  }))
  return out
}

function buildFilterURL(opts: {
  tag?:      string
  untagged?: boolean
  lowconf?:  boolean
  tagged?:   boolean
  quality?:  QualityTier | null
  sort?:     "asc" | "desc"
  gridsort?: GridSort
}): string {
  const params = new URLSearchParams()
  if (opts.tag)                                   params.set("tag",      opts.tag)
  if (opts.untagged)                              params.set("untagged", "1")
  if (opts.lowconf)                               params.set("lowconf",  "1")
  if (opts.tagged)                                params.set("tagged",   "1")
  if (opts.quality)                               params.set("quality",  opts.quality)
  if (opts.sort && opts.sort !== "desc")          params.set("sort",     opts.sort)
  if (opts.gridsort && opts.gridsort !== "auto")  params.set("gridsort", opts.gridsort)
  const qs = params.toString()
  return qs ? `/admin/images-bank?${qs}` : "/admin/images-bank"
}

export default async function ImagesBankPage({ searchParams }: PageProps) {
  const params         = await searchParams
  const tagFilter      = params.tag
  const untaggedFilter = params.untagged === "1"
  const lowConfFilter  = params.lowconf  === "1"
  const withTagsFilter = params.tagged === "1"
  const sortDir: "asc" | "desc" = params.sort === "asc" ? "asc" : "desc"
  // gridSort: el grid SIEMPRE muestra divisores por fecha.
  //   - "auto"   (default): divisores por addedAt (mtime). Dentro de
  //     cada bucket el orden lo decide el criterio intrínseco del
  //     filtro base (más usadas, peores primero, etc).
  //   - "tagged": divisores por taggedAt. Sobreescribe el orden con
  //     fecha de tagging desc.
  const gridSort: GridSort = params.gridsort === "tagged" ? "tagged" : "auto"
  // Validar quality contra el enum — invalid silently ignored
  const qualityFilter: QualityTier | null =
    (QUALITY_TIERS.find((t) => t.id === params.quality)?.id ?? null) as QualityTier | null

  const { classification, audit, error } = await loadData()
  const discoveredMeta = await loadDiscoveredLabels()

  // Helpers locales que merge metadata estática + descubierta por Gemini.
  // Definidos como closure para tener acceso a discoveredMeta sin pasarlo
  // a cada call. Fallback: id en inglés / categoría "Especiales".
  const labelEs = (id: string): string =>
    LABEL_METADATA[id]?.displayEs ?? discoveredMeta[id]?.displayEs ?? id
  const labelCategory = (id: string): Category =>
    LABEL_METADATA[id]?.category ?? discoveredMeta[id]?.category ?? "Especiales"

  if (!classification || !audit) {
    return (
      <div>
        <Link href="/admin" className="back-link">
          <ChevronLeft className="h-4 w-4" />
          Admin
        </Link>
        <header className="page-header">
          <div>
            <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <ImageIcon className="h-7 w-7" />
              Banco de imágenes
            </h1>
            <p className="lead">No se encontraron los JSON de auditoría.</p>
          </div>
        </header>
        <div className="card-soft" style={{ padding: 24, maxWidth: 720 }}>
          <p style={{ margin: 0, marginBottom: 12, fontSize: 14, color: "var(--slate-700)" }}>
            <b>¿Ya tienes los JSONs en local</b> (<code style={{ background: "var(--slate-100)", padding: "1px 5px", borderRadius: 4, fontSize: 11.5 }}>tools/image-audit/</code>)<b>?</b>
            <br />Súbelos a R2 con un comando:
          </p>
          <pre
            style={{
              background:   "var(--slate-100)",
              padding:      14,
              borderRadius: 8,
              fontSize:     12,
              overflowX:    "auto",
              lineHeight:   1.5,
              marginBottom: 16,
            }}
          >{`npm run images:upload-metadata`}</pre>

          <p style={{ margin: 0, marginBottom: 12, fontSize: 14, color: "var(--slate-700)" }}>
            <b>¿Primera vez o vienes de cero?</b> Pipeline completo:
          </p>
          <pre
            style={{
              background:   "var(--slate-100)",
              padding:      14,
              borderRadius: 8,
              fontSize:     12,
              overflowX:    "auto",
              lineHeight:   1.5,
            }}
          >{`# 1. Audit SHA (lee BBDD + filesystem)
npm run images:audit-sha

# 2. Sanitize (1 representante por SHA)
npm run images:sanitize

# 3. Clasificación SigLIP
cd tools/image-classifier
.venv\\Scripts\\activate
python classify_siglip.py

# 4. Subir JSONs a R2 (lo que prod lee)
npm run images:upload-metadata`}</pre>
          <p style={{ marginTop: 12, fontSize: 12, color: "var(--slate-500)" }}>
            Más info: <code style={{ background: "var(--slate-100)", padding: "1px 5px", borderRadius: 4 }}>npm run help</code> → sección <i>🧭 Flujos completos</i>.
          </p>
          {error && (
            <p style={{ marginTop: 16, padding: 10, background: "rgba(239, 68, 68, 0.08)", color: "var(--red-600)", borderRadius: 6, fontSize: 12 }}>
              <AlertCircle className="h-3.5 w-3.5 inline mr-1" />
              {error}
            </p>
          )}
        </div>
      </div>
    )
  }

  // ── Carga lista de archivos físicos + mtime ───────────────────────
  //   - mtime se usa para el sort "Más recientes agregadas"
  //   - existencia se usa para detectar tiles missing
  const filesMtime = await loadFilesMtime()

  // Exclusiones manuales: sha → set(tag_id) que el admin marcó como
  // "no corresponde" desde el banco (swipe Tinder). Las respetamos
  // en runtime aunque el classifier aún no las haya reprocesado.
  const tagExclusionsMap = await loadTagExclusions()
  // Map<sha, count> — cuántas referencias alternativas hay descargadas
  // para cada SHA del banco. Lo pintamos como badge sobre la lupa.
  const referenceCountsMap = await loadReferenceCounts()
  // Confirmaciones: sha → set(tag_id) que admin marcó "SÍ es". El
  // boost del score se aplica en runtime también para que el filtro
  // de calidad las muestre inmediatamente.
  const tagConfirmationsMap = await loadShaTagMap(R2_META_KEYS.tagConfirmations, "confirmations")

  // ── Index SHA → audit info (preguntas) ─────────────────────────────
  const shaToAudit = new Map<string, ShaAuditGroup>()
  for (const g of audit.groups) shaToAudit.set(g.sha256, g)

  // ── Construir entries ──────────────────────────────────────────────
  // `entriesAll` tiene TODAS las entries con exclusiones/confirmaciones
  // aplicadas pero ANTES de los filtros de UI. Sirve para recalcular
  // los counts del sidebar (tagCounts, noTagsCount, etc) — si usáramos
  // classification.stats.tagCounts del JSON, esos valores quedarían
  // congelados al último run del classifier y no reflejarían las
  // exclusiones que el admin va haciendo desde el banco.
  //
  // `entries` (let) parte de entriesAll y se va recortando con cada
  // filtro UI (untagged, lowconf, tag, quality).
  const entriesAll: DisplayEntry[] = Object.entries(classification.images).map(([sha, info]) => {
    const a = shaToAudit.get(sha)
    // Max ID de pregunta — proxy de orden estable (auto-increment).
    const maxQuestionId = a && a.questions.length > 0
      ? Math.max(...a.questions.map((q) => q.id))
      : 0
    // addedAt = mtime del archivo en disco; null si el sha está en
    // classification.json pero el archivo no existe en /public/images/.
    const addedAt = filesMtime.get(info.filename) ?? null
    // taggedAt = ISO del classifier; null si el JSON viene de antes del
    // feature (el classifier hace backfill en su próximo run).
    const taggedAt = info.taggedAt ? Date.parse(info.taggedAt) : null
    // Aplicar exclusiones + confirmaciones manuales en runtime:
    //   - Exclusiones: filtra el tag (no aparece aunque score sea alto)
    //   - Confirmaciones:
    //       1. Marca `humanConfirmed: true` SIEMPRE — independientemente del
    //          score original. La UI usa este flag para pintar el check verde
    //          en la esquina top-left del tag (señal visual de "revisado").
    //       2. Boost del score a CONFIRMED_TAG_MIN_SCORE (0.30 = filtro
    //          "medio") SOLO si el score real es menor. El boost preserva la
    //          decisión humana en el filtro de calidad; cuando el modelo ya
    //          acertaba (score >= 0.30) no tocamos nada.
    // Esto da UX inmediato sin esperar al próximo run del classifier.
    const exclusions    = tagExclusionsMap.get(sha)
    const confirmations = tagConfirmationsMap.get(sha)
    let tagsFiltered = exclusions
      ? info.tags.filter((t) => !exclusions.has(t.tag))
      : info.tags
    if (confirmations) {
      tagsFiltered = tagsFiltered.map((t) =>
        confirmations.has(t.tag)
          ? {
              ...t,
              score:          t.score < CONFIRMED_TAG_MIN_SCORE
                                ? CONFIRMED_TAG_MIN_SCORE
                                : t.score,
              humanConfirmed: true,
            }
          : t,
      )
    }
    return {
      sha,
      filename:      info.filename,
      tags:          tagsFiltered,
      maxScore:      tagsFiltered.reduce((m, t) => Math.max(m, t.score), 0),
      questionCount: a?.questionCount ?? 0,
      // Subset compacto de las preguntas — usado en QuestionsListButton
      questions:     (a?.questions ?? []).map((q) => ({
        id:         q.id,
        externalId: q.externalId,
        codigoTema: q.codigoTema,
      })),
      maxQuestionId,
      addedAt,
      taggedAt: Number.isFinite(taggedAt as number) ? (taggedAt as number) : null,
    }
  })

  // Punto de partida para los filtros UI: copia de entriesAll que se
  // irá recortando. entriesAll se mantiene intacto para los counts del
  // sidebar (que reflejan exclusiones/confirmaciones aplicadas).
  let entries: DisplayEntry[] = entriesAll.slice()

  // ── Aplicar filtro base (untagged / lowconf / withtags / tag) ──────
  // Mutuamente excluyentes — solo uno aplica a la vez. Prioridad por orden.
  let filterLabel = "Todas"
  let filterIcon: React.ReactNode = <TagIcon className="h-4 w-4" />
  if (untaggedFilter) {
    entries     = entries.filter((e) => e.tags.length === 0)
    filterLabel = "Sin ningún tag"
    filterIcon  = <ImageOff className="h-4 w-4" />
  } else if (lowConfFilter) {
    entries     = entries.filter((e) => !e.tags.some((t) => t.confident))
    filterLabel = "Sin tag confident"
    filterIcon  = <EyeOff className="h-4 w-4" />
  } else if (withTagsFilter) {
    entries     = entries.filter((e) => e.tags.length > 0)
    filterLabel = "Con tags"
    filterIcon  = <TagIcon className="h-4 w-4" />
  } else if (tagFilter) {
    entries     = entries.filter((e) => e.tags.some((t) => t.tag === tagFilter))
    filterLabel = `Tag: ${labelEs(tagFilter)}`
  }


  // ── Computar counts de calidad ANTES de filtrar por calidad ────────
  // Los counts reflejan "imágenes que tras los filtros base caen en cada
  // tier de calidad". Si añadimos también filtro de calidad, los demás
  // tiers seguirían mostrando sus counts correctos.
  const qualityCounts: Record<QualityTier, number> = {
    very_high: 0, high: 0, medium: 0, low: 0, very_low: 0,
  }
  for (const e of entries) {
    const t = tierOf(effectiveScore(e, tagFilter))
    if (t) qualityCounts[t]++
  }

  // ── Aplicar filtro de calidad (encima del filtro base) ─────────────
  if (qualityFilter) {
    const tier = QUALITY_TIERS.find((t) => t.id === qualityFilter)!
    entries = entries.filter((e) => {
      const s = effectiveScore(e, tagFilter)
      return s >= tier.min && s < tier.max
    })
    filterLabel += ` · ${tier.label}`
  }

  // ── Sort ────────────────────────────────────────────────────────────
  // "tagged" sobreescribe TODO por taggedAt desc. "auto" aplica el
  // orden intrínseco — ese orden se preserva DENTRO de cada bucket
  // cuando luego agrupamos por addedAt para los divisores.
  if (gridSort === "tagged") {
    entries.sort((a, b) => {
      const da  = a.taggedAt ?? FALLBACK_IMAGE_DATE_MS
      const dbb = b.taggedAt ?? FALLBACK_IMAGE_DATE_MS
      if (da !== dbb) return dbb - da
      return b.maxQuestionId - a.maxQuestionId
    })
  } else if (untaggedFilter || lowConfFilter) {
    // Peores primero (max score asc) — más informativo para iterar prompts
    entries.sort((a, b) => a.maxScore - b.maxScore)
  } else if (tagFilter) {
    // Mejor score primero del tag filtrado
    entries.sort((a, b) => {
      const aScore = a.tags.find((t) => t.tag === tagFilter)?.score ?? 0
      const bScore = b.tags.find((t) => t.tag === tagFilter)?.score ?? 0
      return bScore - aScore
    })
  } else {
    // Por defecto: más usadas primero (mayor impacto si sustituyes)
    entries.sort((a, b) => b.questionCount - a.questionCount)
  }

  // Sin paginación: renderizamos TODAS las entries.
  // LazyTileImage hace lazy-load real por viewport (IntersectionObserver),
  // así el navegador solo descarga las imgs visibles → "scroll infinito"
  // efectivo aunque haya 1700+ tiles en el DOM.
  const totalEntries = entries.length

  // ── Stats para header (recalculadas desde entriesAll) ─────────────
  // Antes leíamos `classification.stats.*` directamente, pero esos
  // counts vienen del último run del classifier y NO reflejan las
  // exclusiones/confirmaciones que el admin ha hecho después desde el
  // banco (swipe Tinder). Recalcularlos desde entriesAll (que tiene
  // las reglas aplicadas) hace que los pills del sidebar bajen al
  // instante cuando el admin marca "No es" sobre una imagen.
  const total = entriesAll.length
  const tagCounts:     Record<string, number> = {}
  const confidentTags: Record<string, number> = {}
  let noTagsCount   = 0
  let noConfCount   = 0
  for (const e of entriesAll) {
    if (e.tags.length === 0) {
      noTagsCount++
      noConfCount++
      continue
    }
    let anyConfident = false
    for (const t of e.tags) {
      tagCounts[t.tag] = (tagCounts[t.tag] ?? 0) + 1
      if (t.confident) {
        confidentTags[t.tag] = (confidentTags[t.tag] ?? 0) + 1
        anyConfident = true
      }
    }
    if (!anyConfident) noConfCount++
  }
  const withTagsCount = total - noTagsCount

  // Agrupar tags por categoría (definida en labelMetadata.ts). Cada
  // categoría se renderiza como un bloque separado en la barra de
  // filtros para que sea más navegable que una lista plana de 40+.
  const tagsByCategory = new Map<Category, Array<{ tag: string; count: number; confident: number }>>()
  for (const [tag, count] of Object.entries(tagCounts)) {
    const cat = labelCategory(tag)
    if (!tagsByCategory.has(cat)) tagsByCategory.set(cat, [])
    tagsByCategory.get(cat)!.push({
      tag,
      count,
      confident: confidentTags[tag] ?? 0,
    })
  }
  // Sort dentro de cada categoría según el flag global
  for (const arr of tagsByCategory.values()) {
    arr.sort((a, b) => sortDir === "asc" ? a.count - b.count : b.count - a.count)
  }
  const totalTagsCount = Object.keys(tagCounts).length

  return (
    <div>
      {/* Client component: si el URL tiene #img-<sha>, hace scroll
          suave + outline naranja al tile correspondiente. Útil para
          "ir a esta imagen desde un tag" — el click en un pill de
          tag dentro de un tile genera `?tag=X#img-Y` y al cargar la
          nueva vista, este componente centra el tile Y. */}
      <ScrollToHashTarget />

      <Link href="/admin" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Admin
      </Link>

      <header className="page-header">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <ImageIcon className="h-7 w-7" />
            Banco de imágenes
          </h1>
          <p className="lead">
            {total} imágenes únicas (por SHA-256) · clasificadas con{" "}
            <code style={{ background: "var(--slate-100)", padding: "1px 6px", borderRadius: 4, fontSize: 12 }}>
              {classification.model}
            </code>
          </p>
        </div>
      </header>

      {/* Stats panel */}
      <div
        className="card-soft"
        style={{
          padding:             16,
          marginBottom:        20,
          display:             "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap:                 16,
        }}
      >
        <StatBox label="Total imágenes"    value={total} />
        <StatBox label="Sin ningún tag"    value={noTagsCount}
                 sub={`${Math.round((noTagsCount / total) * 100)}%`}
                 color={noTagsCount > total * 0.3 ? "warn" : "ok"} />
        <StatBox label="Sin tag confident" value={noConfCount}
                 sub={`${Math.round((noConfCount / total) * 100)}%`}
                 color={noConfCount > total * 0.5 ? "warn" : "ok"} />
        <StatBox label="Tags/img (media)"
                 value={classification.stats?.averageTagsPerImage ?? 0} />
        <StatBox label="Confident/img (media)"
                 value={classification.stats?.averageConfidentPerImage ?? 0} />
      </div>

      {/* Estilos responsive — un solo breakpoint a 1024px.
            ≥ 1024px: sidebar sticky 260px + main grid (layout desktop)
            < 1024px: drawer flotante lateral, abierto/cerrado vía checkbox
                      (sin JS) con FAB fijo en la esquina + backdrop + close.
          Truco CSS: `:root:has(.filters-cb:checked)` selecciona la raíz
          cuando el checkbox está marcado → activa transformaciones en el
          drawer y muestra el backdrop. Funciona en todos los browsers
          modernos (:has() soportado desde Chrome 105/Firefox 121/Safari 15.4). */}
      <style dangerouslySetInnerHTML={{ __html: `
        .filters-cb { position: absolute; opacity: 0; pointer-events: none; width: 0; height: 0; }
        .filters-fab, .filters-backdrop, .filters-close-btn { display: none; }
        .images-bank-layout { display: grid; grid-template-columns: 260px 1fr; gap: 20px; align-items: start; }
        .images-bank-sidebar { position: sticky; top: 16px; max-height: calc(100vh - 32px); overflow-y: auto; padding-right: 8px; border-right: 1px solid var(--slate-100); }
        @media (max-width: 1023px) {
          .images-bank-layout { grid-template-columns: 1fr; }
          .filters-fab {
            display: inline-flex; align-items: center; gap: 8px;
            position: fixed;
            /* Centrado horizontalmente, elevado lo suficiente para no
               chocar con la tabbar inferior móvil de la app (Inicio,
               Competir, Stats, Historial, Más ≈ 64px) + safe-area iOS. */
            left: 50%; transform: translateX(-50%);
            bottom: calc(80px + env(safe-area-inset-bottom, 0px));
            z-index: 150;
            padding: 12px 22px;
            background: linear-gradient(135deg, var(--orange-500, #f97316), var(--red-600, #dc2626));
            color: #fff;
            border-radius: 999px;
            font-size: 13.5px; font-weight: 800; letter-spacing: 0.02em;
            box-shadow: 0 14px 28px -10px rgba(220, 38, 38, 0.55), 0 0 0 1px rgba(255,255,255,0.4);
            cursor: pointer; user-select: none;
            transition: transform 0.15s, box-shadow 0.15s;
          }
          .filters-fab:hover { transform: translateX(-50%) translateY(-2px); box-shadow: 0 18px 32px -10px rgba(220, 38, 38, 0.6), 0 0 0 1px rgba(255,255,255,0.4); }
          .filters-backdrop {
            position: fixed; inset: 0;
            background: rgba(15, 23, 42, 0.5);
            backdrop-filter: blur(2px);
            z-index: 200;
            cursor: pointer;
            opacity: 0; pointer-events: none;
            transition: opacity 0.25s;
          }
          .filters-close-btn {
            display: flex; align-items: center; justify-content: center;
            position: absolute; top: 12px; right: 12px;
            width: 36px; height: 36px;
            border-radius: 999px;
            background: var(--slate-100); color: var(--slate-700);
            cursor: pointer; z-index: 2;
            border: 1px solid var(--slate-200);
          }
          .filters-close-btn:hover { background: var(--slate-200); }
          .images-bank-sidebar {
            position: fixed; top: 0; left: 0;
            width: 320px; max-width: 88vw;
            height: 100vh; max-height: 100vh;
            background: #fff;
            z-index: 201;
            box-shadow: 12px 0 40px rgba(0,0,0,0.25);
            transform: translateX(-100%);
            transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
            overflow-y: auto;
            padding: 56px 20px 24px;
            border-right: none;
          }
          /* Drawer abierto (checkbox marcado) */
          :root:has(.filters-cb:checked) .images-bank-sidebar { transform: translateX(0); }
          :root:has(.filters-cb:checked) .filters-backdrop { opacity: 1; pointer-events: auto; }
          /* Bloquear scroll del body cuando el drawer está abierto */
          :root:has(.filters-cb:checked) body { overflow: hidden; }
        }
      `}} />

      {/* Checkbox oculto que controla el estado del drawer. Junto a sus
          labels (FAB para abrir, backdrop y close-btn para cerrar) forma
          un toggle puro CSS — sin estado React, server-rendered, sin JS. */}
      <input type="checkbox" id="filters-drawer-toggle" className="filters-cb" aria-label="Mostrar/ocultar filtros del banco de imágenes" />
      <label htmlFor="filters-drawer-toggle" className="filters-backdrop" aria-hidden="true" />
      <label htmlFor="filters-drawer-toggle" className="filters-fab" role="button" aria-label="Abrir filtros">
        <TagIcon className="h-4 w-4" />
        Filtros
      </label>

      {/* Layout 2-columnas: sidebar sticky con filtros + main con grid */}
      <div className="images-bank-layout">

        {/* ────────────────────────────────────────────────────────────
            SIDEBAR (sticky en desktop, drawer flotante < 1024px)
            ──────────────────────────────────────────────────────────── */}
        <aside className="images-bank-sidebar" aria-label="Filtros del banco">
          {/* Botón cerrar — solo visible en mobile (CSS) */}
          <label htmlFor="filters-drawer-toggle" className="filters-close-btn" role="button" aria-label="Cerrar filtros">
            <X className="h-4 w-4" />
          </label>
          {/* ── Filtros especiales ── */}
          <SidebarHeader>Filtros especiales</SidebarHeader>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 18 }}>
            <FilterPill
              label="Todas"
              count={total}
              href={buildFilterURL({ gridsort: gridSort })}
              active={!untaggedFilter && !lowConfFilter && !withTagsFilter && !tagFilter && !qualityFilter}
            />
            <FilterPill
              label="Sin tag"
              count={noTagsCount}
              href={buildFilterURL({ untagged: true, gridsort: gridSort })}
              active={untaggedFilter}
              color="warn"
              icon={<ImageOff className="h-3 w-3" />}
            />
            <FilterPill
              label="Sin confident"
              count={noConfCount}
              href={buildFilterURL({ lowconf: true, gridsort: gridSort })}
              active={lowConfFilter}
              color="warn"
              icon={<EyeOff className="h-3 w-3" />}
            />
            <FilterPill
              label="Con tags"
              count={withTagsCount}
              href={buildFilterURL({ tagged: true, gridsort: gridSort })}
              active={withTagsFilter}
              color="ok"
              icon={<TagIcon className="h-3 w-3" />}
            />
          </div>

          {/* ── Calidad (probabilidad sigmoid) ── */}
          <SidebarHeader>Calidad</SidebarHeader>
          <div style={{ fontSize: 10, color: "var(--slate-400)", marginBottom: 8, lineHeight: 1.3 }}>
            {tagFilter ? `Score del tag actual` : `Max score por imagen`}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 18 }}>
            <QualityPill
              label="Todas"
              count={entries.length}
              tierColor="var(--slate-100)"
              active={!qualityFilter}
              showDot={false}
              href={buildFilterURL({ tag: tagFilter, untagged: untaggedFilter, lowconf: lowConfFilter, sort: sortDir, quality: null, gridsort: gridSort })}
            />
            {QUALITY_TIERS.map((t) => (
              <QualityPill
                key={t.id}
                label={t.label}
                count={qualityCounts[t.id]}
                tierColor={t.color}
                active={qualityFilter === t.id}
                showDot
                title={`${t.min.toFixed(2)} ≤ score < ${t.max.toFixed(2)}`}
                href={buildFilterURL({ tag: tagFilter, untagged: untaggedFilter, lowconf: lowConfFilter, sort: sortDir, quality: t.id, gridsort: gridSort })}
              />
            ))}
          </div>

          {/* ── Ordenar grid ── (complementario a todo lo demás) */}
          <SidebarHeader>Ordenar grid</SidebarHeader>
          <div style={{ fontSize: 10, color: "var(--slate-400)", marginBottom: 8, lineHeight: 1.3 }}>
            Siempre con divisores por fecha (Hoy / Esta semana / …)
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 18 }}>
            <SortToggle
              active={gridSort === "auto"}
              label="Por defecto"
              title="Orden intrínseco (más usadas, peores primero, etc) dentro de cada bucket de fecha (agrupado por mtime del archivo)"
              href={buildFilterURL({ tag: tagFilter, untagged: untaggedFilter, lowconf: lowConfFilter, tagged: withTagsFilter, quality: qualityFilter, sort: sortDir, gridsort: "auto" })}
            />
            <SortToggle
              active={gridSort === "tagged"}
              label="🏷️ Nuevas tagueadas"
              title="Ordena por fecha de tagging del classifier (útil tras añadir labels nuevos)"
              href={buildFilterURL({ tag: tagFilter, untagged: untaggedFilter, lowconf: lowConfFilter, tagged: withTagsFilter, quality: qualityFilter, sort: sortDir, gridsort: "tagged" })}
            />
          </div>

          {/* ── Por tag (con búsqueda + sort toggle) ── */}
          <SidebarHeader>Por tag ({totalTagsCount})</SidebarHeader>
          <TagSearchInput />
          <div style={{ display: "flex", gap: 3, marginBottom: 8 }}>
            <SortToggle
              active={sortDir === "desc"}
              label="↓ más usadas"
              title="Más usadas primero"
              href={buildFilterURL({ tag: tagFilter, untagged: untaggedFilter, lowconf: lowConfFilter, quality: qualityFilter, sort: "desc", gridsort: gridSort })}
            />
            <SortToggle
              active={sortDir === "asc"}
              label="↑ menos"
              title="Menos usadas primero — útil para detectar tags poco efectivos"
              href={buildFilterURL({ tag: tagFilter, untagged: untaggedFilter, lowconf: lowConfFilter, quality: qualityFilter, sort: "asc", gridsort: gridSort })}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {CATEGORIES.map((cat) => {
              const tags = tagsByCategory.get(cat) ?? []
              if (tags.length === 0) return null
              return (
                <div key={cat}>
                  <div data-tag-category={cat} style={categoryHeaderStyle}>{cat}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {tags.map(({ tag, count, confident }) => (
                      <FilterPill
                        key={tag}
                        label={labelEs(tag)}
                        count={count}
                        subCount={confident}
                        href={buildFilterURL({ tag, sort: sortDir, quality: qualityFilter, gridsort: gridSort })}
                        active={tagFilter === tag}
                        isNew={isLabelNew(tag, discoveredMeta[tag]?.discoveredAt)}
                        searchText={`${labelEs(tag)} ${tag} ${cat}`}
                      />
                    ))}
                  </div>
                </div>
              )
            })}

            {/* "Otros" — tags sin metadata estática */}
            {(() => {
              const known = new Set<string>(
                Array.from(tagsByCategory.values()).flat().map((t) => t.tag)
              )
              const orphans = Object.entries(tagCounts)
                .filter(([t]) => !known.has(t))
                .sort((a, b) => sortDir === "asc" ? a[1] - b[1] : b[1] - a[1])
              if (orphans.length === 0) return null
              return (
                <div>
                  <div data-tag-category="Otros" style={categoryHeaderStyle}>Otros (sin metadata)</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {orphans.map(([tag, count]) => (
                      <FilterPill
                        key={tag}
                        label={tag}
                        count={count}
                        subCount={confidentTags[tag] ?? 0}
                        href={buildFilterURL({ tag, sort: sortDir, quality: qualityFilter, gridsort: gridSort })}
                        active={tagFilter === tag}
                        isNew={isLabelNew(tag, discoveredMeta[tag]?.discoveredAt)}
                        searchText={tag}
                      />
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>
        </aside>

        {/* ────────────────────────────────────────────────────────────
            MAIN (derecha) — header + grid sin paginación
            ──────────────────────────────────────────────────────────── */}
        <main>
          {/* Resultados header */}
          <div style={{
            display:        "flex",
            alignItems:     "center",
            justifyContent: "space-between",
            marginBottom:   12,
            fontSize:       14,
            color:          "var(--slate-700)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
              {filterIcon}
              {filterLabel}
              <span style={{ color: "var(--slate-500)", fontWeight: 400 }}>
                · {totalEntries.toLocaleString("es")} imágenes
              </span>
            </div>
            <div style={{ fontSize: 11, color: "var(--slate-400)" }}>
              Scroll infinito · imgs lazy-loaded
            </div>
          </div>

          {/* Grid de tiles — todas renderizadas, lazy-loaded por viewport */}
          {entries.length === 0 ? (
            <div className="card-soft" style={{ padding: 32, textAlign: "center", color: "var(--slate-500)" }}>
              No hay imágenes que coincidan con este filtro.
            </div>
          ) : (
            // Siempre con divisores temporales:
            //   - "auto"   → divisores por addedAt (mtime). Dentro de
            //               cada bucket conserva el orden intrínseco.
            //   - "tagged" → divisores por taggedAt (orden ya por fecha).
            <>
              {groupByDateBucket(
                entries,
                gridSort === "tagged"
                  ? (e) => e.taggedAt
                  : (e) => e.addedAt,
              ).map((group) => (
                <div key={group.bucket}>
                  <DateDivider label={group.label} sub={group.sub} count={group.entries.length} />
                  <div
                    style={{
                      display:             "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                      gap:                 12,
                    }}
                  >
                    {group.entries.map((entry) => {
                      // Anchor id para ScrollToHashTarget — el click de
                      // un pill de tag dentro de un tile añade
                      // `#img-<sha>` al URL y al cargar la nueva vista
                      // se hace scrollIntoView + highlight de ese tile.
                      const anchorId = `img-${entry.sha}`
                      const tile = (
                        <ImageTile
                          entry={entry}
                          currentTag={tagFilter}
                          getDisplay={labelEs}
                          anchorId={tagFilter ? undefined : anchorId}
                          refsCount={referenceCountsMap.get(entry.sha) ?? 0}
                          buildTagURL={(tag) => {
                            const url = buildFilterURL({
                              tag:      tag === tagFilter ? undefined : tag,
                              sort:     sortDir,
                              quality:  qualityFilter,
                              gridsort: gridSort,
                            })
                            return `${url}#img-${entry.sha}`
                          }}
                        />
                      )
                      if (tagFilter) {
                        return (
                          <SwipeableImageTile
                            key={`${entry.sha}-${tagFilter}`}
                            entry={entry}
                            tag={tagFilter}
                            tagDisplay={labelEs(tagFilter)}
                            anchorId={anchorId}
                          >
                            {tile}
                          </SwipeableImageTile>
                        )
                      }
                      // Sin tagFilter: CardHashUpdater actualiza #img-<sha> al clickar
                      // → ScrollToHashTarget lo usa para restaurar posición al recargar
                      return (
                        <CardHashUpdater key={entry.sha} sha={entry.sha}>
                          {tile}
                        </CardHashUpdater>
                      )
                    })}
                  </div>
                </div>
              ))}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

// Pills (FilterPill, QualityPill, SortToggle) y headers (SidebarHeader)
// viven en ./BankUi.tsx — compartidos con el modal del picker.
// Styles helpers (qualityPillStyle, etc.) en ./lib.ts.

// ── Subcomponentes locales (no compartidos) ───────────────────────────

function StatBox({ label, value, sub, color }: {
  label: string
  value: number | string
  sub?:  string
  color?: "warn" | "ok"
}) {
  const accent = color === "warn" ? "var(--red-600)" : "var(--ink)"
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--slate-500)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div className="font-mono-tabular" style={{ fontSize: 22, fontWeight: 900, color: accent, lineHeight: 1.2, marginTop: 4 }}>
        {typeof value === "number" ? value.toLocaleString("es") : value}
        {sub && (
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--slate-500)", marginLeft: 6 }}>
            ({sub})
          </span>
        )}
      </div>
    </div>
  )
}

function ImageTile({ entry, currentTag, getDisplay, buildTagURL, anchorId, refsCount }: {
  entry:      DisplayEntry
  currentTag: string | undefined
  getDisplay: (id: string) => string
  /** Opcional: id HTML para que ScrollToHashTarget pueda hacer
   *  scrollIntoView. Se omite cuando el tile está dentro de un
   *  SwipeableImageTile (el wrapper externo lleva el id para evitar
   *  duplicados). */
  anchorId?:  string
  /** Devuelve la URL de navegación para clickear un tag. El caller
   *  decide la semántica de toggle (si tag === currentTag, devuelve
   *  URL sin filtro de tag; si no, aplica el filtro). */
  buildTagURL: (tag: string) => string
  /** Cuántas referencias alternativas se han descargado para esta SHA.
   *  El botón lupa pinta un badge con este número si > 0. */
  refsCount:   number
}) {
  // Resuelto vía CDN (R2) en prod o /images/ local en dev — ver lib/imageUrl
  const imgSrc = imageUrl(entry.filename)
  return (
    <div
      id={anchorId}
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
      {isImageNew(entry.addedAt) && <NewImageBadge />}
      <LazyTileImage src={imgSrc} alt={entry.sha.slice(0, 8)} />

      <div style={{ padding: 8, fontSize: 11, display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
          <div className="font-mono-tabular" style={{ fontSize: 9.5, color: "var(--slate-400)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
            {entry.sha.slice(0, 16)}…
          </div>
          {/* Botón "buscar referencias visuales" — admin only (todo /admin/*
              gateado en layout.tsx). Modal lazy-load. El badge sobre la
              lupa muestra cuántas refs ya se guardaron para este SHA. */}
          <FindReplacementsButton sha={entry.sha} currentTags={entry.tags} refsCount={refsCount} />
        </div>

        <div style={{ color: "var(--slate-600)", fontSize: 10.5 }}>
          <QuestionsListButton questions={entry.questions} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 2 }}>
          {entry.tags.length === 0 ? (
            <span style={{ fontSize: 10, color: "var(--slate-400)", fontStyle: "italic" }}>
              (sin tags)
            </span>
          ) : (
            entry.tags.map((t) => {
              const isFiltered = currentTag === t.tag
              return (
                <Link
                  key={t.tag}
                  href={buildTagURL(t.tag)}
                  title={
                    t.humanConfirmed
                      ? `✓ Revisado por admin · ${isFiltered ? "Quitar filtro" : "Filtrar por"}: ${t.tag}`
                      : isFiltered ? `Quitar filtro: ${t.tag}` : `Filtrar por: ${t.tag}`
                  }
                  style={{
                    position:       "relative",  // necesario para el badge absolute
                    display:        "flex",
                    justifyContent: "space-between",
                    alignItems:     "center",
                    fontSize:       10,
                    padding:        "1px 6px",
                    paddingLeft:    t.humanConfirmed ? 12 : 6,  // espacio para el badge
                    borderRadius:   3,
                    textDecoration: "none",
                    cursor:         "pointer",
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
                    transition: "filter 0.12s",
                    // Borde verde sutil si está confirmado, para reforzar la
                    // señal del badge sin saturar (la mayoría de tags ya tienen
                    // fondo verde claro por t.confident=true).
                    boxShadow: t.humanConfirmed
                      ? "inset 0 0 0 1px rgba(22, 163, 74, 0.45)"
                      : undefined,
                  }}
                >
                  {t.humanConfirmed && (
                    <span
                      aria-hidden="true"
                      style={{
                        position:       "absolute",
                        top:            -3,
                        left:           -3,
                        width:          11,
                        height:         11,
                        background:     "#16a34a",  // green-600
                        color:          "white",
                        borderRadius:   "50%",
                        display:        "inline-flex",
                        alignItems:     "center",
                        justifyContent: "center",
                        // Anillo blanco fino para que el badge "flote" sobre
                        // cualquier fondo (verde claro del tile, naranja del
                        // filtro activo, gris del unconfident).
                        boxShadow:      "0 0 0 1.5px white",
                        zIndex:         1,
                      }}
                    >
                      <Check size={7} strokeWidth={3.5} />
                    </span>
                  )}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {getDisplay(t.tag)}
                  </span>
                  <span className="font-mono-tabular" style={{ fontSize: 9.5, marginLeft: 4, flexShrink: 0 }}>
                    {t.score.toFixed(2)}
                  </span>
                </Link>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
