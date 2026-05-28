/**
 * Tipos + utilidades compartidas para el banco de imágenes.
 *
 * Pure TS (sin imports de fs / server-only) → se puede importar tanto
 * desde server components (page.tsx) como desde client components
 * (ImageBankPicker.tsx) sin problemas de bundling.
 */

import type { CSSProperties } from "react"

export const QUALITY_TIERS = [
  { id: "very_high", label: "Muy alta", min: 0.70, max: 1.01, color: "#16a34a" },
  { id: "high",      label: "Alta",     min: 0.50, max: 0.70, color: "#84cc16" },
  { id: "medium",    label: "Medio",    min: 0.30, max: 0.50, color: "#eab308" },
  { id: "low",       label: "Bajo",     min: 0.15, max: 0.30, color: "#f97316" },
  { id: "very_low",  label: "Muy bajo", min: 0.05, max: 0.15, color: "#ef4444" },
] as const

export type QualityTier = typeof QUALITY_TIERS[number]["id"]

export function tierOf(score: number): QualityTier | null {
  for (const t of QUALITY_TIERS) {
    if (score >= t.min && score < t.max) return t.id
  }
  return null
}

export interface ClassificationTag {
  tag:       string
  score:     number
  confident: boolean
  /** El admin ha marcado "SÍ es" para esta (sha, tag) desde el banco.
   *  Se hidrata en runtime cruzando con tag_confirmations.json. El score
   *  ORIGINAL se preserva (excepto por el boost a CONFIRMED_TAG_MIN_SCORE
   *  cuando estaba por debajo). UI muestra un badge verde de "revisado"
   *  en la esquina top-left del tag. */
  humanConfirmed?: boolean
  /** El admin ha marcado "NO es" para esta (sha, tag). En `tags` los
   *  excluidos se filtran out → este flag SOLO existirá en contextos
   *  donde queramos preservar la decisión sin ocultar el tag (e.g.
   *  vistas de auditoría). En el flujo normal del banco no aparece. */
  humanExcluded?: boolean
  /** Tag asignado MANUALMENTE por el admin desde el banco (no por el
   *  classifier). Hidratado en runtime desde meta/manual_tags.json. Si
   *  un tag manual coincide con uno que el classifier ya descubrió,
   *  se fusiona y el flag se añade al original. Si no coincide, se
   *  inserta como entry NUEVA con score = 1.0 y confident = true. UI
   *  lo pinta con borde azul + badge "M". */
  humanAssigned?: boolean
  /** ISO timestamp de la asignación manual (solo si humanAssigned). */
  assignedAt?:    string
  /** Username del admin que asignó (solo si humanAssigned). */
  assignedBy?:    string
  /** Justificación libre opcional del admin (solo si humanAssigned).
   *  El clasificador la usa como few-shot example en el próximo run. */
  reason?:        string
}

export interface ClassificationImage {
  filename:  string
  tags:      ClassificationTag[]
  allScores: Record<string, number>
  /** ISO 8601 — momento en que el classifier procesó esta imagen.
   *  Opcional para retrocompat con classification.json antiguos
   *  (anteriores al feature). El classifier hace backfill al cargar
   *  el JSON previo con el `generatedAt` global. */
  taggedAt?: string
}

export interface ClassificationData {
  generatedAt:     string
  model:           string
  threshold:       number
  topK:            number
  minScore:        number
  imagesProcessed: number
  labels:          { id: string; prompts: string[] }[]
  images:          Record<string, ClassificationImage>
  stats?: {
    tagCounts:                 Record<string, number>
    confidentTagCounts:        Record<string, number>
    imagesWithoutTags:         number
    imagesWithoutConfidentTag: number
    averageTagsPerImage:       number
    averageConfidentPerImage:  number
  }
}

export interface ShaAuditGroup {
  sha256:        string
  sizeBytes:     number
  filenames:     string[]
  questionCount: number
  questions:     { id: number; externalId: string; imagen: string; codigoTema: string | null }[]
}

export interface ShaAuditData {
  generatedAt:  string
  groups:       ShaAuditGroup[]
  orphanFiles:  string[]
  missingFiles: string[]
}

export interface DiscoveredLabelData {
  generatedAt?: string
  count?:       number
  labels:       { id: string; displayEs: string; category: string; prompts: string[]; discoveredAt?: string }[]
}

/**
 * Exclusiones manuales de tags por imagen (admin marca "esta imagen NO
 * es de este tag"). Persistido en tools/image-audit/tag_exclusions.json.
 * Al re-correr el classifier, los tags excluidos NO se emiten para esa
 * SHA aunque el score sea alto.
 *
 * Shape: sha (sha256 hex) → lista de tag IDs a excluir.
 */
export interface TagExclusionsData {
  generatedAt: string
  /** Map sha → tags excluidos. Pensado como dict para lookup O(1) en
   *  Python (al filtrar) y JS (al renderizar). */
  exclusions:  Record<string, string[]>
}

/**
 * Confirmaciones manuales de tags por imagen (admin marca "esta imagen
 * SÍ es de este tag"). Persistido en tools/image-audit/tag_confirmations.json.
 *
 * Efecto: el classifier hace BOOST del score del tag a `CONFIRMED_TAG_MIN_SCORE`
 * (actualmente 0.30 — entra en filtro "Calidad medio"). Si el score
 * actual ya supera ese mínimo, se respeta el valor real (no se baja).
 *
 * NOTA DE PERMISOS: solo ADMIN puede registrar confirmaciones. Cuando
 * se añadan roles como "autoescuela", NO podrán hacer esta acción de
 * escritura crítica sobre el clasificador.
 */
export interface TagConfirmationsData {
  generatedAt:   string
  confirmations: Record<string, string[]>
}

/**
 * Score mínimo que recibe un tag tras confirmación manual del admin.
 * Coincide con el límite inferior del tier "medium" en QUALITY_TIERS
 * → la imagen aparece bajo el filtro "Calidad medio" o superior.
 *
 * Si el score real ya es >= este valor, no se aplica boost (el real
 * gana). Si es <, se eleva a este mínimo.
 *
 * Sincronizado con `CONFIRMED_TAG_MIN_SCORE` en classify_siglip.py.
 */
export const CONFIRMED_TAG_MIN_SCORE = 0.30

/** Info compacta de una pregunta que referencia una imagen.
 *  Subset de ShaAuditGroup.questions sin `imagen` (redundante con el
 *  filename ya conocido). Usado en los tiles para mostrar la lista
 *  expandible de preguntas que usan la imagen. */
export interface EntryQuestionRef {
  id:         number
  externalId: string
  codigoTema: string | null
}

export interface DisplayEntry {
  sha:            string
  filename:       string
  tags:           ClassificationTag[]
  maxScore:       number
  questionCount:  number
  /** Lista de las preguntas que usan esta imagen. Vacío si la imagen
   *  está huérfana (sin preguntas asociadas). */
  questions:      EntryQuestionRef[]
  /** Máximo ID de pregunta entre las que referencian esta imagen.
   *  Proxy de "orden estable" — los IDs son auto-increment. 0 si la
   *  imagen no está en ninguna pregunta. */
  maxQuestionId:  number
  /** Timestamp (ms) de cuándo el archivo apareció en disco — mtime
   *  del filesystem. null si la imagen no existe en public/images/
   *  (caso raro pero posible: orfana en classification.json). */
  addedAt:        number | null
  /** Timestamp (ms) de cuándo el classifier (SigLIP) procesó esta
   *  imagen. null si la imagen no está en classification.json o
   *  el JSON viene de antes del feature (sin haberse re-corrido
   *  el classifier — entonces no hay backfill). */
  taggedAt:       number | null
  /** True si esta entry NO está en classification.json todavía — es
   *  una referencia alternativa guardada por el admin desde Lens/stock
   *  y el classifier no la ha procesado aún. UI la pinta atenuada con
   *  badge "PENDIENTE". El `addedAt` proviene del downloadedAt del
   *  registry para que aparezca arriba en "Más recientes". */
  pendingClassification?: boolean
  /** Solo poblado si pendingClassification === true. Metadatos de la
   *  fuente original para que el admin sepa de dónde vino. */
  pendingSource?: {
    originalSha:       string
    /** Filename de la imagen original en classification.json (si existe).
     *  Permite construir la URL pública para previsualizarla en un modal.
     *  null si el SHA original ya no está en el banco (raro pero posible
     *  si el admin la borró tras haber descargado refs). */
    originalFilename?: string | null
    sourceUrl?:        string
    provider:          string
    attribution?:      string
  }
  /** Cuántas referencias alternativas (Lens/Pixabay/Pexels) se han
   *  descargado a partir de esta imagen — para mostrar como badge y
   *  para el filtro/sort "Con más refs". 0 / undefined si ninguna o
   *  si el caller no las consultó. */
  refsCount?:     number
  /** True si este SHA aparece como `newSha` en alguna entry de
   *  alternative_references.json — es decir, esta imagen VINO de un
   *  proveedor externo en un guardado anterior. La UI deshabilita la
   *  búsqueda Lens sobre ella porque buscarle refs a una ref no tiene
   *  sentido (ya está catalogada en internet y el resultado sería
   *  pobre o redundante). */
  isAlternativeReference?: boolean
}

/** Modos de orden del grid:
 *   - "auto":   orden intrínseco del filtro base (untagged/lowconf=peores
 *               primero, tag=mejor score primero, resto=más usadas) PERO
 *               siempre con divisores por fecha de agregado (mtime del
 *               archivo). Dentro de cada bucket el orden lo decide el
 *               criterio intrínseco.
 *   - "recent": ignora el orden intrínseco y ordena POR FECHA addedAt
 *               desc dentro de cada bucket. Las imágenes recién añadidas
 *               al banco salen primero. Útil tras descargar referencias
 *               nuevas o tras procesar SHAs nuevos.
 *   - "refs":   ordena por refsCount desc — las imágenes con más
 *               referencias alternativas descargadas (Lens/stock) salen
 *               primero. Útil para auditar el trabajo del admin sobre
 *               qué SHAs ha intentado sustituir más veces.
 *   - "tagged": ordena por fecha de tagging desc + divisores por la
 *               misma fecha. Sobreescribe el orden intrínseco. Útil
 *               tras añadir labels nuevos para ver qué imágenes acaba
 *               de procesar el classifier.
 *  En TODOS los modos hay divisores temporales (Hoy / Esta semana / …). */
export type GridSort = "auto" | "recent" | "refs" | "tagged"

/** Id de un bucket temporal. Antes era un enum fijo (today, this_week,
 *  this_month, ...) pero los divisores quedaban muy gruesos: 6 días
 *  apilados bajo "Esta semana" sin distinguir si son de ayer o de hace
 *  6 días. Ahora son DINÁMICOS:
 *    - Día calendario individual para los últimos 7 días:
 *        "today", "yesterday", "day:2", ..., "day:6"
 *    - Mes para 7+ días pero menos de 12 meses: "month:2026-05"
 *    - Año para 12+ meses: "year:2025"
 *    - "no_date" sigue siendo el bucket residual.
 *  String porque los ids dinámicos no caben en una union limitada. */
export type DateBucket = string

/**
 * Fecha de fallback para imágenes que en el modo activo no tienen
 * timestamp. Aplica selectivamente:
 *   - Modo "added"  → solo si `addedAt === null` (raro: archivo perdido).
 *   - Modo "tagged" → si `taggedAt === null` (frecuente hasta que se
 *                     re-corre el classifier).
 *
 * Valor: 2026-05-25 15:00:00 UTC = 17:00 hora España (mayo, CEST = UTC+2).
 * Si el día que se re-corre el classifier ya está lejos de esta fecha,
 * puedes actualizarla aquí o quitar el fallback. */
export const FALLBACK_IMAGE_DATE_MS = new Date("2026-05-25T15:00:00Z").getTime()

/** Días que una imagen se considera "nueva" desde su mtime. Reusa la
 *  misma constante que `isLabelNew` (labelMetadata.ts) para consistencia
 *  visual entre badges de tags y de imágenes. Si quieres ventanas
 *  distintas para cada tipo, separar en dos constantes. */
export const NEW_IMAGE_BADGE_DAYS = 7

/**
 * Devuelve true si la imagen es "reciente" según su mtime (`addedAt`).
 * Se usa para mostrar el badge "NEW" en la esquina del tile.
 *
 * Importante: NO usa `FALLBACK_IMAGE_DATE_MS` — si `addedAt === null`
 * (archivo no encontrado en disco), devolvemos false. El badge solo
 * sale para imágenes REALMENTE recientes en disco.
 */
export function isImageNew(addedAt: number | null, now: number = Date.now()): boolean {
  if (addedAt === null) return false
  const ageMs = now - addedAt
  return ageMs >= 0 && ageMs < NEW_IMAGE_BADGE_DAYS * 86_400_000
}

const MONTH_NAMES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
] as const

/** Fecha estilo "27 mayo 2026" — para el `sub` del divisor. */
function formatLongDateEs(date: Date): string {
  const month = MONTH_NAMES_ES[date.getMonth()].toLowerCase()
  return `${date.getDate()} ${month} ${date.getFullYear()}`
}

interface BucketInfo {
  id:      DateBucket
  label:   string
  sub:     string
  /** Para ordenar los buckets cronológicamente desc (mayor = más reciente). */
  sortKey: number
}

/**
 * Calcula el bucket temporal de un timestamp (ms desde epoch). Devuelve
 * id + label + sub listos para mostrar, y un sortKey para que el caller
 * ordene los buckets cronológicamente desc sin reimplementar la lógica.
 *
 * Estrategia (granularidad creciente según antigüedad):
 *   - Mismo día calendario que `now`           → "Hoy"
 *   - Día calendario anterior                  → "Ayer"
 *   - Entre 2 y 6 días calendario antes        → "Hace N días" (uno por día)
 *   - Menos de 12 meses calendario antes       → "<Mes> <Año>" (uno por mes)
 *   - 12+ meses antes                          → "<Año>"
 *   - timestampMs === null                     → "Sin fecha conocida"
 *
 * Diferencia con la versión anterior: antes los 6 días entre 1 y 7 se
 * apilaban todos bajo "Esta semana"; ahora cada día tiene su propio
 * divisor y se ven separados. Después del séptimo día agrupamos por
 * mes (no por trimestre) para que las imgs procesadas en mayo y en
 * abril no se mezclen.
 *
 * `now` parametrizable para tests deterministas.
 */
export function dateBucketInfoOf(timestampMs: number | null, now: number = Date.now()): BucketInfo {
  if (timestampMs === null) {
    return { id: "no_date", label: "Sin fecha conocida", sub: "sin info de fecha", sortKey: -Infinity }
  }
  const ts        = new Date(timestampMs)
  const nowDate   = new Date(now)
  // Diferencia en DÍAS CALENDARIO (no en ventanas de 24h reales). Una
  // imagen subida ayer a las 23:59 cuenta como "Ayer" aunque hayan
  // pasado solo 2 horas.
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const daysAgo = Math.floor((startOf(nowDate) - startOf(ts)) / 86_400_000)
  const longDate = formatLongDateEs(ts)

  if (daysAgo <= 0) return { id: "today",     label: "Hoy",   sub: longDate, sortKey: timestampMs }
  if (daysAgo === 1) return { id: "yesterday", label: "Ayer",  sub: longDate, sortKey: timestampMs }
  if (daysAgo < 7)   return { id: `day:${daysAgo}`, label: `Hace ${daysAgo} días`, sub: longDate, sortKey: timestampMs }

  // Diferencia en meses calendario. Una img de octubre vista en mayo
  // del año siguiente = 7 meses (no años).
  const monthDiff = (nowDate.getFullYear() - ts.getFullYear()) * 12
                  + (nowDate.getMonth()     - ts.getMonth())

  if (monthDiff < 12) {
    const ym  = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}`
    const label = `${MONTH_NAMES_ES[ts.getMonth()]} ${ts.getFullYear()}`
    return {
      id:      `month:${ym}`,
      label,
      sub:     `mes completo`,
      // sortKey por (año*12 + mes) escalado a un rango grande para
      // mantenerse por debajo de los días pero por encima de los años.
      sortKey: (ts.getFullYear() * 12 + ts.getMonth()) * 1e6,
    }
  }

  // 12+ meses → bucket por año
  return {
    id:      `year:${ts.getFullYear()}`,
    label:   `${ts.getFullYear()}`,
    sub:     "año completo",
    sortKey: ts.getFullYear(),
  }
}

/** Compat: la API vieja devolvía solo el id como string. Algunos tests
 *  externos podrían usarla. Mantengo el nombre y delego al nuevo helper. */
export function dateBucketOf(timestampMs: number | null, now: number = Date.now()): DateBucket {
  return dateBucketInfoOf(timestampMs, now).id
}

export interface DateBucketGroup {
  bucket:   DateBucket
  label:    string
  sub:      string
  entries:  DisplayEntry[]
}

/**
 * Agrupa entries en buckets temporales según la fecha que devuelva
 * `selector(entry)`. El caller decide qué campo usar:
 *   - `(e) => e.addedAt`  → modo "Más recientes agregadas"
 *   - `(e) => e.taggedAt` → modo "Más recientes tagueadas"
 *
 * Preserva el orden interno de `entries` dentro de cada bucket (el
 * caller pre-ordena por fecha desc). Los buckets se devuelven en orden
 * cronológico desc (más recientes primero), con "Sin fecha conocida"
 * al final.
 *
 * `now` parametrizable para tests deterministas.
 */
export function groupByDateBucket(
  entries: DisplayEntry[],
  selector: (e: DisplayEntry) => number | null,
  now: number = Date.now(),
): DateBucketGroup[] {
  // Acumulamos por id de bucket + recordamos la metadata (label, sub,
  // sortKey) de la primera entry que cayó en cada uno — todas las del
  // mismo bucket tienen la misma label/sub salvo la fecha exacta, que
  // mostramos como rango si difieren (se hace abajo).
  const byBucket = new Map<DateBucket, { info: BucketInfo; entries: DisplayEntry[] }>()
  for (const e of entries) {
    const info = dateBucketInfoOf(selector(e), now)
    const cur  = byBucket.get(info.id)
    if (cur) cur.entries.push(e)
    else     byBucket.set(info.id, { info, entries: [e] })
  }
  // Orden final: buckets cronológicamente desc por sortKey ("Hoy" arriba,
  // "Sin fecha conocida" abajo del todo con sortKey -Infinity).
  const out: DateBucketGroup[] = [...byBucket.values()]
    .sort((a, b) => b.info.sortKey - a.info.sortKey)
    .map(({ info, entries: es }) => ({
      bucket:  info.id,
      label:   info.label,
      sub:     info.sub,
      entries: es,
    }))
  return out
}

export function effectiveScore(entry: DisplayEntry, filteredTag?: string): number {
  if (filteredTag) {
    return entry.tags.find((t) => t.tag === filteredTag)?.score ?? 0
  }
  return entry.maxScore
}

/**
 * Payload de /api/admin/images-bank/data. Consumido por ImageBankPicker.
 * El page.tsx no lo usa (lee directo del filesystem en server) pero el
 * formato debe coincidir con lo que devuelve el API.
 */
export interface BankApiPayload {
  classification: ClassificationData
  audit:          ShaAuditData
  discovered:     DiscoveredLabelData | null
  /** Filename → mtime (ms) del archivo en disco. Usado tanto para
   *  detectar "missing files" (basta `filename in map`) como para
   *  el sort "Más recientes agregadas". Los archivos huérfanos en
   *  disco también aparecen aquí; los huérfanos en classification.json
   *  no. */
  existingFilesMtime: Record<string, number>
  /** Exclusiones manuales de tags por sha. El admin marca "esta imagen
   *  NO es de este tag" desde el banco (Tinder-swipe) y se persiste
   *  aquí. El classifier las respeta en el próximo run. El frontend
   *  las usa para feedback visual + para no re-mostrar imágenes que
   *  el admin ya rechazó del filtro actual. */
  tagExclusions:  Record<string, string[]>
  /** Confirmaciones manuales de tags por sha. El admin marca "esta
   *  imagen SÍ es de este tag" desde el banco. El classifier hace boost
   *  del score a CONFIRMED_TAG_MIN_SCORE (0.30 = filtro "medio"). */
  tagConfirmations: Record<string, string[]>
}

// ── Style helpers (compartidos page.tsx ↔ ImageBankPicker) ────────────
// Si quieres que un pill se vea distinto, toca AQUÍ y los dos sitios
// se actualizan. Mantenidos como funciones puras (sin JSX) para que se
// puedan importar desde server components también.

export type PillColor = "warn" | "ok" | undefined

/** Background degradado del pill cuando está activo. Depende del "color"
 *  semántico (warn=rojo, ok=verde, default=naranja-rojo). */
export function activePillBackground(color: PillColor): string {
  if (color === "warn") return "linear-gradient(135deg, var(--red-500), var(--red-600))"
  if (color === "ok")   return "linear-gradient(135deg, var(--green), var(--green-d))"
  return                      "linear-gradient(135deg, var(--orange-500), var(--red-600))"
}

/** Style base de un pill de calidad (tier sigmoid). Color de fondo activo
 *  = color del tier (verde→rojo según probabilidad). */
export function qualityPillStyle(active: boolean, tierColor: string): CSSProperties {
  return {
    display:        "flex",
    alignItems:     "center",
    justifyContent: "space-between",
    padding:        "5px 10px",
    borderRadius:   8,
    fontSize:       11.5,
    fontWeight:     600,
    textDecoration: "none",
    background:     active ? tierColor : "var(--slate-100)",
    color:          active ? "#fff" : "var(--slate-700)",
    border:         active ? "0" : "1px solid var(--slate-200)",
    cursor:         "pointer",
    width:          "100%",
    textAlign:      "left",
  }
}

/** Style del toggle "↓ más usadas / ↑ menos" del sidebar. */
export function sortTogglePillStyle(active: boolean): CSSProperties {
  return {
    padding:        "3px 8px",
    borderRadius:   10,
    fontSize:       10,
    fontWeight:     700,
    textDecoration: "none",
    background:     active ? "var(--ink)" : "var(--slate-100)",
    color:          active ? "#fff" : "var(--slate-600)",
    border:         "1px solid var(--slate-200)",
    cursor:         "pointer",
  }
}

/** Cabeceras de las secciones del sidebar ("Filtros especiales", "Calidad"…). */
export const sidebarHeaderStyle: CSSProperties = {
  fontSize:       11,
  color:          "var(--slate-500)",
  fontWeight:     700,
  textTransform:  "uppercase",
  letterSpacing:  "0.05em",
  marginBottom:   8,
}

/** Cabecera de cada categoría de tags dentro del bloque "Por tag". */
export const categoryHeaderStyle: CSSProperties = {
  fontSize:       10,
  color:          "var(--slate-400)",
  fontWeight:     700,
  textTransform:  "uppercase",
  letterSpacing:  "0.05em",
  marginBottom:   4,
}
