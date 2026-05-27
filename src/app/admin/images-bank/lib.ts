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
}

/** Modos de orden del grid:
 *   - "auto":   orden intrínseco del filtro base (untagged/lowconf=peores
 *               primero, tag=mejor score primero, resto=más usadas) PERO
 *               siempre con divisores por fecha de agregado (mtime del
 *               archivo). Dentro de cada bucket el orden lo decide el
 *               criterio intrínseco.
 *   - "tagged": ordena por fecha de tagging desc + divisores por la
 *               misma fecha. Sobreescribe el orden intrínseco. Útil
 *               tras añadir labels nuevos para ver qué imágenes acaba
 *               de procesar el classifier.
 *  En AMBOS modos hay divisores temporales (Hoy / Esta semana / …). */
export type GridSort = "auto" | "tagged"

/** Buckets temporales para los divisores del grid en modo "más recientes".
 *  Orden = orden visual (de más reciente a más antiguo). */
export type DateBucket =
  | "today"
  | "this_week"
  | "this_month"
  | "last_3_months"
  | "older"
  | "no_date"

export const DATE_BUCKETS: { id: DateBucket; label: string; sub: string }[] = [
  { id: "today",         label: "Hoy",                sub: "últimas 24h" },
  { id: "this_week",     label: "Esta semana",        sub: "últimos 7 días" },
  { id: "this_month",    label: "Este mes",           sub: "últimos 30 días" },
  { id: "last_3_months", label: "Últimos 3 meses",    sub: "31-90 días" },
  { id: "older",         label: "Más antiguas",       sub: "más de 90 días" },
  // Bucket residual. En modo "Más recientes agregadas" raramente cae
  // algo (todo archivo en disco tiene mtime). En modo "Más recientes
  // tagueadas" cae si el classifier aún no se ha re-corrido tras el
  // upgrade — el fallback (más abajo) lo evita en práctica.
  { id: "no_date",       label: "Sin fecha conocida", sub: "sin info de fecha" },
]

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

/** Calcula el bucket temporal de un timestamp (ms desde epoch). `now`
 *  parametrizable para tests deterministas. */
export function dateBucketOf(timestampMs: number | null, now: number = Date.now()): DateBucket {
  if (timestampMs === null) return "no_date"
  const ageMs = now - timestampMs
  const day = 86_400_000
  if (ageMs < day)        return "today"
  if (ageMs < 7  * day)   return "this_week"
  if (ageMs < 30 * day)   return "this_month"
  if (ageMs < 90 * day)   return "last_3_months"
  return "older"
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
 * caller pre-ordena por fecha desc). Solo devuelve buckets no vacíos
 * en el orden canónico (Hoy → … → Sin fecha).
 *
 * `now` parametrizable para tests deterministas.
 */
export function groupByDateBucket(
  entries: DisplayEntry[],
  selector: (e: DisplayEntry) => number | null,
  now: number = Date.now(),
): DateBucketGroup[] {
  const byBucket = new Map<DateBucket, DisplayEntry[]>()
  for (const e of entries) {
    const b = dateBucketOf(selector(e), now)
    if (!byBucket.has(b)) byBucket.set(b, [])
    byBucket.get(b)!.push(e)
  }
  // Devolver en orden canónico (DATE_BUCKETS ya está ordenado)
  const out: DateBucketGroup[] = []
  for (const b of DATE_BUCKETS) {
    const list = byBucket.get(b.id)
    if (list && list.length > 0) {
      out.push({ bucket: b.id, label: b.label, sub: b.sub, entries: list })
    }
  }
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
