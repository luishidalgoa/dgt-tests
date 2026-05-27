import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { createHash } from "node:crypto"
import { requireAdmin } from "@/lib/adminGuard"
import {
  getJsonFromR2,
  putJsonToR2,
  putBinaryToR2,
  R2_META_KEYS,
  type AlternativeReference,
  type AlternativeReferencesData,
} from "@/lib/imagesBankR2"

/**
 * POST /api/admin/images-bank/save-reference
 *
 * Descarga un candidato (Pixabay/Pexels/Unsplash/Google Lens) y lo guarda
 * en R2 como una "referencia alternativa" del SHA original. NO reemplaza
 * Question.imagen — solo deja la imagen disponible en el bucket para que
 * el clasificador la procese en su próximo run y la etiquete.
 *
 * Persiste también un registro en meta/alternative_references.json:
 *   { originalSha → AlternativeReference[] }
 * para que la UI pueda mostrar "X referencias descargadas" junto a cada
 * tile y auditar de dónde vinieron.
 *
 * Body:
 *   {
 *     originalSha:   string  // SHA-256 hex 64 — la imagen del banco que inspiró
 *     candidateUrl:  string  // URL del candidato (Pixabay/Pexels/Lens)
 *     sourceUrl?:    string  // página fuente (para auditoría); cae a candidateUrl
 *     provider?:     string  // "pixabay" | "pexels" | "unsplash" | "serpapi"
 *     attribution?:  string  // autor / sitio fuente reportado por el provider
 *   }
 *
 * Response:
 *   {
 *     ok:                true,
 *     newSha:            string,        // SHA del binario subido
 *     newFilename:       string,        // "<newSha>.<ext>"
 *     dedup:             boolean,       // true si ya estaba guardada para este originalSha
 *     totalForOriginal:  number,        // refs guardadas para originalSha tras esta acción
 *   }
 */

export const dynamic    = "force-dynamic"
export const maxDuration = 30  // descarga + R2 binary + R2 json

const bodySchema = z.object({
  originalSha:  z.string().regex(/^[a-f0-9]{64}$/, "originalSha debe ser hex sha256 (64 chars)"),
  candidateUrl: z.string().url("candidateUrl debe ser URL válida"),
  sourceUrl:    z.string().url().optional(),
  provider:     z.string().min(1).max(40).optional(),
  attribution:  z.string().min(1).max(200).optional(),
})

// Límites de seguridad — evita que un candidato malicioso descargue 500MB.
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024   // 10 MB
const MIN_DOWNLOAD_BYTES = 1 * 1024            // 1 KB

const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg":    "jpg",
  "image/jpg":     "jpg",
  "image/png":     "png",
  "image/webp":    "webp",
  "image/gif":     "gif",
}

const USER_AGENT = "Mozilla/5.0 (compatible; DGT-Tests-Bot/1.0)"

export async function POST(req: NextRequest) {
  const admin = await requireAdmin()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Body JSON inválido" }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    )
  }
  const { originalSha, candidateUrl, sourceUrl, provider, attribution } = parsed.data

  // ── 1. Descargar el candidato ─────────────────────────────────────
  let candidateBytes:       Buffer
  let candidateContentType: string
  try {
    const res = await fetch(candidateUrl, {
      headers:  { "User-Agent": USER_AGENT, Accept: "image/*" },
      signal:   AbortSignal.timeout(20_000),
      redirect: "follow",
    })
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Candidate download HTTP ${res.status}` },
        { status: 502 },
      )
    }
    const ct = (res.headers.get("Content-Type") ?? "").toLowerCase().split(";")[0].trim()
    if (!ALLOWED_CONTENT_TYPES[ct]) {
      return NextResponse.json(
        { ok: false, error: `Content-Type no permitido: ${ct}. Permitidos: ${Object.keys(ALLOWED_CONTENT_TYPES).join(", ")}` },
        { status: 400 },
      )
    }
    const arrayBuffer  = await res.arrayBuffer()
    candidateBytes        = Buffer.from(arrayBuffer)
    candidateContentType  = ct
    if (candidateBytes.length < MIN_DOWNLOAD_BYTES) {
      return NextResponse.json(
        { ok: false, error: `Candidato demasiado pequeño (${candidateBytes.length} bytes)` },
        { status: 400 },
      )
    }
    if (candidateBytes.length > MAX_DOWNLOAD_BYTES) {
      return NextResponse.json(
        { ok: false, error: `Candidato demasiado grande (${(candidateBytes.length / 1024 / 1024).toFixed(1)} MB > ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB)` },
        { status: 400 },
      )
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Download failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    )
  }

  // ── 2. Calcular SHA + extensión ───────────────────────────────────
  const newSha      = createHash("sha256").update(candidateBytes).digest("hex")
  const ext         = ALLOWED_CONTENT_TYPES[candidateContentType]
  const newFilename = `${newSha}.${ext}`

  // Si por coincidencia el nuevo SHA == originalSha (mismo binario), no
  // hacer nada — sería un duplicado consigo mismo.
  if (newSha === originalSha) {
    return NextResponse.json(
      {
        ok:    false,
        error: `El candidato es BIT-A-BIT idéntico a la imagen original (mismo SHA). No tiene sentido guardarlo como referencia.`,
      },
      { status: 400 },
    )
  }

  // ── 3. Leer estado actual de meta/alternative_references.json ─────
  let registry: AlternativeReferencesData
  try {
    const existing = await getJsonFromR2<AlternativeReferencesData>(R2_META_KEYS.alternativeReferences)
    registry = existing ?? { version: 1, references: {} }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `No se pudo leer alternative_references.json: ${err instanceof Error ? err.message : err}` },
      { status: 500 },
    )
  }

  const list = registry.references[originalSha] ?? []
  const alreadyExists = list.some((r) => r.sha === newSha)

  // ── 4. Subir binario a R2 (solo si no estaba ya) ──────────────────
  // Aunque ya estuviera en el registry, la PUT a R2 es idempotente —
  // si el blob ya existe lo sobreescribe con los mismos bytes. Pero
  // ahorrarnos la subida cuando el dedup es claro es cortés con la
  // cuota R2 y la latencia. Lo saltamos si dedup.
  if (!alreadyExists) {
    try {
      await putBinaryToR2(newFilename, candidateBytes, candidateContentType)
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: `R2 binary upload failed: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 },
      )
    }

    // ── 5. Actualizar el registry ──────────────────────────────────
    const entry: AlternativeReference = {
      sha:          newSha,
      ext,
      sourceUrl:    sourceUrl ?? candidateUrl,
      provider:     provider ?? "unknown",
      attribution,
      downloadedAt: new Date().toISOString(),
      addedBy:      admin.username,
    }
    registry.references[originalSha] = [...list, entry]
    try {
      await putJsonToR2(R2_META_KEYS.alternativeReferences, registry)
    } catch (err) {
      // Si el JSON falla pero la imagen subió, devolvemos error con aviso:
      // la imagen quedó huérfana en R2. Hay que limpiarla manualmente.
      return NextResponse.json(
        {
          ok:              false,
          error:           `Imagen subida pero registry NO actualizado: ${err instanceof Error ? err.message : String(err)}`,
          orphanFilename:  newFilename,
        },
        { status: 500 },
      )
    }
  }

  const totalForOriginal = registry.references[originalSha]?.length ?? 0

  return NextResponse.json({
    ok:                true,
    newSha,
    newFilename,
    dedup:             alreadyExists,
    totalForOriginal,
  })
}
