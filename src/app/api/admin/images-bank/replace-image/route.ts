import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { createHash } from "node:crypto"
import { requireAdmin } from "@/lib/adminGuard"
import { db } from "@/lib/db"
import { putBinaryToR2 } from "@/lib/imagesBankR2"

/**
 * POST /api/admin/images-bank/replace-image
 *
 * Sustituye una imagen del banco DGT por una nueva (descarga URL → calcula
 * SHA → sube a R2 → actualiza Question.imagen en BBDD para todas las
 * preguntas que apuntaban al SHA viejo).
 *
 * IMPORTANTE: NO borra la imagen vieja de R2. Si el admin se arrepiente, la
 * versión anterior sigue ahí. La limpieza la haces manualmente con
 * `images:clean-r2` cuando estés seguro.
 *
 * Body:
 *   {
 *     originalSha:   string  // SHA-256 de la imagen actual (hex 64)
 *     candidateUrl:  string  // URL de la imagen nueva (de Pixabay/Pexels/etc)
 *   }
 *
 * Response:
 *   {
 *     ok:             true,
 *     newSha:         string,   // SHA-256 del binario descargado
 *     newFilename:    string,   // "<newSha>.<ext>"
 *     newContentType: string,
 *     questionsUpdated: number, // cuántas preguntas se actualizaron
 *   }
 */

export const dynamic = "force-dynamic"
export const maxDuration = 30  // hasta 30s para descarga + upload + DB update

const bodySchema = z.object({
  originalSha:  z.string().regex(/^[a-f0-9]{64}$/, "originalSha debe ser hex sha256 (64 chars)"),
  candidateUrl: z.string().url("candidateUrl debe ser URL válida"),
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
  await requireAdmin()

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
  const { originalSha, candidateUrl } = parsed.data

  // ── 1. Encontrar las preguntas que apuntan al originalSha ─────────
  // Question.imagen es un filename como "<sha>.png" — buscamos por LIKE.
  const oldImagenPattern = `${originalSha}.%`
  const affectedQuestions = await db.question.findMany({
    where:  { imagen: { startsWith: originalSha } },
    select: { id: true, externalId: true, imagen: true },
  })

  if (affectedQuestions.length === 0) {
    return NextResponse.json(
      {
        ok:    false,
        error: `Ninguna pregunta apunta al SHA '${originalSha.slice(0, 12)}…'. ` +
               `¿Estás seguro de que esa es la imagen actual?`,
      },
      { status: 404 },
    )
  }

  // ── 2. Descargar el candidato ─────────────────────────────────────
  let candidateBytes: Buffer
  let candidateContentType: string
  try {
    const res = await fetch(candidateUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "image/*" },
      signal:  AbortSignal.timeout(20_000),
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
    const arrayBuffer = await res.arrayBuffer()
    candidateBytes       = Buffer.from(arrayBuffer)
    candidateContentType = ct
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

  // ── 3. Calcular SHA del nuevo binario ─────────────────────────────
  const newSha       = createHash("sha256").update(candidateBytes).digest("hex")
  const ext          = ALLOWED_CONTENT_TYPES[candidateContentType]
  const newFilename  = `${newSha}.${ext}`

  // Si por coincidencia el nuevo SHA == originalSha (mismo binario), no
  // hacer nada — sería un no-op confuso.
  if (newSha === originalSha) {
    return NextResponse.json(
      {
        ok:    false,
        error: `El candidato es BIT-A-BIT idéntico a la imagen actual (mismo SHA). No hay nada que reemplazar.`,
      },
      { status: 400 },
    )
  }

  // ── 4. Subir a R2 ──────────────────────────────────────────────────
  try {
    await putBinaryToR2(newFilename, candidateBytes, candidateContentType)
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `R2 upload failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }

  // ── 5. Actualizar Question.imagen en BBDD ─────────────────────────
  // Atómico: todas las Q que apuntaban al sha viejo pasan al nuevo filename.
  // Usamos updateMany para evitar N+1 queries.
  let updateCount = 0
  try {
    const result = await db.question.updateMany({
      where: { imagen: { startsWith: originalSha } },
      data:  { imagen: newFilename },
    })
    updateCount = result.count
  } catch (err) {
    return NextResponse.json(
      {
        ok:               false,
        error:            `DB update failed (R2 SI se subió — manual cleanup): ${err instanceof Error ? err.message : String(err)}`,
        newFilenameInR2:  newFilename,
      },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok:               true,
    newSha,
    newFilename,
    newContentType:   candidateContentType,
    questionsUpdated: updateCount,
    // Auditoría útil para el frontend si quiere notificar al usuario
    affectedQuestionIds: affectedQuestions.map((q) => q.id),
  })
}
