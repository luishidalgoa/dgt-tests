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
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"

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
