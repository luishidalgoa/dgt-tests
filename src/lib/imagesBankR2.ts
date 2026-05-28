/**
 * Cliente R2 compartido para los JSONs de metadata del banco de imágenes.
 *
 * Por qué R2 (no bbdd, no fs):
 *   - Mismo bucket que ya tienes para imágenes → cero infra extra.
 *   - Funciona en Vercel (fs read-only en prod no permite persistir
 *     exclusiones/confirmaciones del admin).
 *   - El classifier local sube los JSONs y prod los lee al instante,
 *     sin redeploy. Los toggles de "no es" / "sí es" desde admin se
 *     persisten en R2 directamente.
 *
 * Keys: todas bajo prefix `meta/` para separarlas claramente de los
 * binarios de imagen. R2 NO soporta carpetas reales — es solo
 * convención visual en el dashboard.
 *
 * Concurrencia: writes son "last-write-wins". Para 1 admin clicando en
 * serie no es problema. Si llegase a haber concurrencia real, R2
 * soporta condicional con `If-Match: <ETag>` para compare-and-swap;
 * el código actual no lo usa porque añade complejidad innecesaria.
 *
 * Errores:
 *   - getJsonFromR2 devuelve null si la key no existe (NoSuchKey) —
 *     el caller usa estructura vacía por defecto.
 *   - putJsonToR2 lanza si falla — se propaga al endpoint que devuelve
 *     500 al cliente.
 *   - getR2Client lanza si faltan credenciales — el endpoint también
 *     devuelve 500 con mensaje claro.
 */
import { S3Client, GetObjectCommand, PutObjectCommand, type PutObjectCommandInput } from "@aws-sdk/client-s3"

// ── Keys de los JSONs en el bucket ────────────────────────────────────
// Bajo prefix `meta/` para separarlos de las imágenes (que están en la raíz).
export const R2_META_KEYS = {
  classification:        "meta/classification.json",
  shaAudit:              "meta/sha-audit.json",
  discoveredLabels:      "meta/discovered_labels.json",
  refinedLabels:         "meta/refined_labels.json",
  prototypes:            "meta/prototypes.json",
  tagExclusions:         "meta/tag_exclusions.json",
  tagConfirmations:      "meta/tag_confirmations.json",
  alternativeReferences: "meta/alternative_references.json",
  manualTags:            "meta/manual_tags.json",
} as const

// Nombre local (para el script de upload desde tools/image-audit/)
export const LOCAL_TO_R2_KEY: Record<string, string> = {
  "classification.json":          R2_META_KEYS.classification,
  "sha-audit.json":               R2_META_KEYS.shaAudit,
  "discovered_labels.json":       R2_META_KEYS.discoveredLabels,
  "refined_labels.json":          R2_META_KEYS.refinedLabels,
  "prototypes.json":              R2_META_KEYS.prototypes,
  "tag_exclusions.json":          R2_META_KEYS.tagExclusions,
  "tag_confirmations.json":       R2_META_KEYS.tagConfirmations,
  "alternative_references.json":  R2_META_KEYS.alternativeReferences,
  "manual_tags.json":             R2_META_KEYS.manualTags,
}

// ── Tipo del JSON de referencias alternativas ────────────────────────
// El admin descarga imágenes de Google Lens / stock APIs como "referencias"
// (no como reemplazos) para que el clasificador las procese más adelante.
// Cada referencia se ata al SHA original que la inspiró — útil para auditar
// y para mostrar "X referencias ya descargadas" junto a cada tile.
export interface AlternativeReference {
  /** SHA-256 del binario descargado (= filename en R2). */
  sha:           string
  /** Extensión (jpg, png, webp…). */
  ext:           string
  /** URL pública de donde se descargó (Pixabay/Pexels/Lens). */
  sourceUrl:     string
  /** "pixabay" | "pexels" | "unsplash" | "serpapi". */
  provider:      string
  /** Atribución reportada por el provider (autor / sitio fuente). */
  attribution?:  string
  /** ISO timestamp de la descarga. */
  downloadedAt:  string
  /** Username del admin que la guardó. */
  addedBy?:      string
}

export interface AlternativeReferencesData {
  version:    number
  /** Map originalSha → array de referencias guardadas para ese SHA. */
  references: Record<string, AlternativeReference[]>
}

// ── Tipo del JSON de tags manuales ───────────────────────────────────
// El admin puede asignar tags directamente a una imagen (sin pasar por
// el classifier). Persistimos quién, cuándo y un `reason` opcional para
// que el LLM lo use en el próximo run del classifier como prototipo
// kNN con narrativa de razonamiento — eso permite que el modelo aprenda
// no solo "esta imagen → ese tag" sino TAMBIÉN POR QUÉ (vía text emb
// del reason fundido con el visual emb).
export interface ManualTag {
  /** Id del label (igual que en LABELS). */
  tag:           string
  /** ISO timestamp de la asignación. */
  assignedAt:    string
  /** Username del admin que asignó. */
  assignedBy:    string
  /** Explicación libre opcional. Si está vacía, el clasificador solo
   *  usa el binding sha↔tag como prototipo positivo. Si tiene texto, lo
   *  embebe en el ejemplo few-shot que se le pasa al LLM. */
  reason?:       string
}

export interface ManualTagsData {
  version: number
  /** Map sha → array de tags manuales para ese SHA. */
  entries: Record<string, ManualTag[]>
}

// ── Cliente S3 lazy-init ──────────────────────────────────────────────
// Cacheado a nivel de módulo: el SDK reusa conexiones HTTP/keep-alive
// entre llamadas, importante en serverless donde el cold-start es caro.
let _client: S3Client | null = null
let _bucket: string | null = null

function getR2Client(): { client: S3Client; bucket: string } {
  if (_client && _bucket) return { client: _client, bucket: _bucket }

  const accountId       = process.env.R2_ACCOUNT_ID
  const accessKeyId     = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket          = process.env.R2_BUCKET_NAME

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "R2 credentials missing — define R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y R2_BUCKET_NAME",
    )
  }

  _client = new S3Client({
    region:      "auto",  // R2 ignora region pero el SDK lo exige
    endpoint:    `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
  _bucket = bucket
  return { client: _client, bucket: _bucket }
}

/**
 * Lee un JSON de R2 por key. Devuelve null si no existe (NoSuchKey).
 * Cualquier otro error (credenciales, red, JSON corrupto) se propaga.
 */
export async function getJsonFromR2<T = unknown>(key: string): Promise<T | null> {
  const { client, bucket } = getR2Client()
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    const text = await res.Body?.transformToString()
    if (!text) return null
    return JSON.parse(text) as T
  } catch (err) {
    // NoSuchKey o 404 → null (estructura vacía esperada por el caller)
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return null
    throw err
  }
}

/**
 * Sobreescribe un JSON en R2. Last-write-wins (sin condicional).
 * Content-Type explícito para que el dashboard de Cloudflare lo
 * previsualice como JSON en vez de descargarlo.
 */
export async function putJsonToR2(key: string, data: unknown): Promise<void> {
  const { client, bucket } = getR2Client()
  await client.send(new PutObjectCommand({
    Bucket:       bucket,
    Key:          key,
    Body:         JSON.stringify(data, null, 2),
    ContentType:  "application/json; charset=utf-8",
    CacheControl: "no-cache",  // R2 + CDN no debe cachear — queremos lectura fresca
  }))
}

// ── Compare-And-Set (CAS) sobre JSONs de R2 ──────────────────────────
// Resuelve la race condition de read-modify-write con last-write-wins
// del putJsonToR2 normal: si dos requests procesan el mismo JSON en
// paralelo, ambas leen el mismo estado inicial y la segunda write
// pisa los cambios de la primera (entries "revivían" tras delete).
//
// El patrón CAS:
//   1. GET → devuelve `{ data, etag }`.
//   2. Mutar data en memoria.
//   3. PUT con header `If-Match: <etag>` — R2 acepta solo si la versión
//      actual en R2 sigue siendo la que leímos.
//   4. Si la PUT falla con 412 Precondition Failed, otro escribió en
//      medio → reintentamos desde 1 (backoff exponencial).
//
// Esto serializa eficientemente sin necesidad de un lock externo.

export interface JsonWithEtag<T> {
  data: T | null
  /** ETag del objeto en R2. null si el objeto no existía. */
  etag: string | null
}

/** Lee un JSON de R2 devolviendo el ETag para CAS. */
export async function getJsonFromR2WithEtag<T = unknown>(key: string): Promise<JsonWithEtag<T>> {
  const { client, bucket } = getR2Client()
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    const text = await res.Body?.transformToString()
    const etag = res.ETag ?? null
    if (!text) return { data: null, etag }
    return { data: JSON.parse(text) as T, etag }
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) {
      return { data: null, etag: null }
    }
    throw err
  }
}

/**
 * Sobreescribe un JSON en R2 condicionalmente — solo si el ETag actual
 * coincide con `ifMatch`. Si pasas `ifMatch=null`, la write solo tiene
 * éxito si el objeto NO existía previamente (`If-None-Match: *`).
 *
 * Lanza `R2PreconditionFailedError` con HTTP 412 si la condición no se
 * cumple (es decir, otro escribió en medio). El caller debe re-leer y
 * reintentar.
 */
export class R2PreconditionFailedError extends Error {
  constructor(public key: string) {
    super(`R2 PUT precondition failed for key '${key}' — otro proceso escribió en medio`)
    this.name = "R2PreconditionFailedError"
  }
}

export async function putJsonToR2WithIfMatch(
  key:     string,
  data:    unknown,
  ifMatch: string | null,
): Promise<void> {
  const { client, bucket } = getR2Client()
  const cmd: PutObjectCommandInput = {
    Bucket:       bucket,
    Key:          key,
    Body:         JSON.stringify(data, null, 2),
    ContentType:  "application/json; charset=utf-8",
    CacheControl: "no-cache",
  }
  if (ifMatch === null) {
    // "Crea solo si no existe" — útil al inicializar JSONs por primera
    // vez sin pisar uno que otro proceso pudo crear simultáneamente.
    cmd.IfNoneMatch = "*"
  } else {
    cmd.IfMatch = ifMatch
  }
  try {
    await client.send(new PutObjectCommand(cmd))
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
    if (e?.name === "PreconditionFailed" || e?.$metadata?.httpStatusCode === 412) {
      throw new R2PreconditionFailedError(key)
    }
    throw err
  }
}

/**
 * Helper de alto nivel: lee, muta, escribe — con reintentos automáticos
 * si otro proceso escribió en medio. La función `mutate` recibe el
 * estado actual (o null si no existe) y debe devolver el nuevo estado;
 * se llama de nuevo en cada reintento con la versión fresca.
 *
 * Lanza si tras `maxRetries` aún hay conflicto. En la práctica, con
 * delays exponenciales de ~25ms × N, suele resolver en 1-2 reintentos
 * incluso bajo alta concurrencia.
 */
export async function updateJsonInR2<T>(
  key:        string,
  mutate:     (current: T | null) => T | null,
  maxRetries: number = 5,
): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { data, etag } = await getJsonFromR2WithEtag<T>(key)
    const next = mutate(data)
    // Si la mutación devuelve EXACTAMENTE el mismo objeto que leyó (no
    // hay cambios), saltamos la write — ahorra una request y dependemos
    // menos del cluster R2 en hot loops.
    if (next === data) return
    try {
      await putJsonToR2WithIfMatch(key, next, etag)
      return
    } catch (err) {
      if (err instanceof R2PreconditionFailedError && attempt < maxRetries - 1) {
        // Backoff exponencial con jitter: 25-50ms, 50-100ms, 100-200ms...
        const base   = 25 * Math.pow(2, attempt)
        const jitter = Math.random() * base
        await new Promise((r) => setTimeout(r, base + jitter))
        continue
      }
      throw err
    }
  }
  throw new R2PreconditionFailedError(key)
}

/**
 * Sube un binario (imagen) a R2 con su content-type específico.
 * Usado por el endpoint `save-reference` para guardar candidatos descargados
 * de Pixabay/Pexels/Unsplash/Lens con su SHA como key, sin asociarlos
 * todavía a ninguna Question — el clasificador los etiquetará después.
 *
 * Cache: 1 año (immutable). El SHA en el filename garantiza que cambios
 * en la imagen producen una key nueva — no hay invalidación necesaria.
 */
export async function putBinaryToR2(
  key:         string,
  body:        Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  const { client, bucket } = getR2Client()
  await client.send(new PutObjectCommand({
    Bucket:       bucket,
    Key:          key,
    Body:         body,
    ContentType:  contentType,
    CacheControl: "public, max-age=31536000, immutable",
  }))
}
