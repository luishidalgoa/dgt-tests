import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { requireAdmin } from "@/lib/adminGuard"
import { db } from "@/lib/db"
import {
  getJsonFromR2,
  putJsonToR2,
  R2_META_KEYS,
  type AlternativeReferencesData,
  type ManualTagsData,
} from "@/lib/imagesBankR2"

/**
 * POST /api/admin/images-bank/delete-image
 *
 * Borra una imagen del banco completamente:
 *   1. Verifica si alguna `Question.imagen` apunta a este SHA — si sí
 *      y NO se pasa `force: true`, devuelve 409 con la lista de
 *      preguntas afectadas. El admin debe decidir explícitamente.
 *   2. Quita la entry de `classification.json` (sha → tags).
 *   3. Limpia referencias del sha en `tag_confirmations.json`,
 *      `tag_exclusions.json`, `manual_tags.json`.
 *   4. Si el sha era originalSha en `alternative_references.json`,
 *      borra la key (sus sub-refs siguen siendo SHAs válidos por
 *      sí mismos — no se borran en cascada).
 *   5. Si el sha era newSha en `alternative_references.json` (era una
 *      ref descargada para otro original), lo quita del array
 *      correspondiente.
 *   6. Borra el binario `<sha>.<ext>` de R2.
 *   7. Si `force` y había preguntas, hace `UPDATE Question SET imagen=NULL`
 *      para esas preguntas (sin imagen rota).
 *
 * Permisos: solo admin (requireAdmin en cada call + UI gateada por
 * /admin/layout.tsx).
 *
 * Body:
 *   {
 *     sha:   string  // SHA-256 hex 64
 *     force?: boolean // override del check de Question.imagen
 *   }
 *
 * Response (éxito):
 *   {
 *     ok: true,
 *     deletedFromR2: boolean,
 *     metadataCleaned: { classification, confirmations, exclusions, manualTags, altRefsAsOriginal, altRefsAsRef },
 *     questionsNulled: number,
 *   }
 *
 * Response (preguntas afectadas, no force):
 *   {
 *     ok: false,
 *     error: "...",
 *     affectedQuestions: [{id, externalId}],
 *     code: "HAS_QUESTIONS",
 *   } status: 409
 */

export const dynamic    = "force-dynamic"
export const maxDuration = 30

const bodySchema = z.object({
  sha:   z.string().regex(/^[a-f0-9]{64}$/, "sha debe ser hex sha256 (64 chars)"),
  force: z.boolean().optional(),
})

function getR2Client(): { client: S3Client; bucket: string } {
  const account = process.env.R2_ACCOUNT_ID
  const key     = process.env.R2_ACCESS_KEY_ID
  const secret  = process.env.R2_SECRET_ACCESS_KEY
  const bucket  = process.env.R2_BUCKET_NAME
  if (!account || !key || !secret || !bucket) {
    throw new Error("Faltan creds R2 en .env")
  }
  return {
    client: new S3Client({
      region:      "auto",
      endpoint:    `https://${account}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: key, secretAccessKey: secret },
    }),
    bucket,
  }
}

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
  const { sha, force } = parsed.data

  // ── 1. Verificar Question.imagen ────────────────────────────────
  // El filename en Question.imagen es `${sha}.${ext}` — match por prefix.
  const affectedQuestions = await db.question.findMany({
    where:  { imagen: { startsWith: sha } },
    select: { id: true, externalId: true, imagen: true },
  })
  if (affectedQuestions.length > 0 && !force) {
    return NextResponse.json(
      {
        ok:    false,
        code:  "HAS_QUESTIONS",
        error: `${affectedQuestions.length} pregunta${affectedQuestions.length === 1 ? "" : "s"} apunta${affectedQuestions.length === 1 ? "" : "n"} a esta imagen.`,
        affectedQuestions: affectedQuestions.map((q) => ({
          id:         q.id,
          externalId: q.externalId,
          imagen:     q.imagen,
        })),
      },
      { status: 409 },
    )
  }

  // ── 2. Limpieza de metadata JSONs en R2 ─────────────────────────
  // Cargamos los JSONs relevantes en paralelo y vamos limpiando cada
  // uno. La extensión la deducimos del filename si está en
  // classification, si no de alternative_references — la necesitamos
  // para borrar el binario correcto de R2.
  const [classification, confirmations, exclusions, manualTags, altRefs] = await Promise.all([
    getJsonFromR2<{ images: Record<string, { filename: string }> }>(R2_META_KEYS.classification),
    getJsonFromR2<{ confirmations?: Record<string, string[]> }>(R2_META_KEYS.tagConfirmations),
    getJsonFromR2<{ exclusions?:    Record<string, string[]> }>(R2_META_KEYS.tagExclusions),
    getJsonFromR2<ManualTagsData>(R2_META_KEYS.manualTags),
    getJsonFromR2<AlternativeReferencesData>(R2_META_KEYS.alternativeReferences),
  ])

  let extension: string | null = null
  let classificationDirty = false
  let confirmationsDirty  = false
  let exclusionsDirty     = false
  let manualTagsDirty     = false
  let altRefsDirty        = false
  let altRefsAsOriginal   = false
  let altRefsAsRef        = false

  // 2a. classification.json — quita la entry, deduce extension
  if (classification?.images?.[sha]) {
    const filename = classification.images[sha].filename
    const dotIdx = filename.lastIndexOf(".")
    if (dotIdx >= 0) extension = filename.slice(dotIdx + 1).toLowerCase()
    delete classification.images[sha]
    classificationDirty = true
  }

  // 2b. tag_confirmations.json
  if (confirmations?.confirmations?.[sha]) {
    delete confirmations.confirmations[sha]
    confirmationsDirty = true
  }

  // 2c. tag_exclusions.json
  if (exclusions?.exclusions?.[sha]) {
    delete exclusions.exclusions[sha]
    exclusionsDirty = true
  }

  // 2d. manual_tags.json
  if (manualTags?.entries?.[sha]) {
    delete manualTags.entries[sha]
    manualTagsDirty = true
  }

  // 2e. alternative_references.json — el SHA puede ser:
  //   - originalSha (clave del map) → borrar la entry entera
  //   - newSha (item de algún array) → quitar el item
  if (altRefs?.references) {
    if (altRefs.references[sha]) {
      delete altRefs.references[sha]
      altRefsAsOriginal = true
      altRefsDirty = true
    }
    for (const [originalSha, arr] of Object.entries(altRefs.references)) {
      const beforeLen = arr.length
      const filtered  = arr.filter((r) => r.sha !== sha)
      if (filtered.length !== beforeLen) {
        // Captura la ext de la sub-ref antes de filtrar (necesaria si
        // classification.json no la tenía).
        if (!extension) {
          const removed = arr.find((r) => r.sha === sha)
          if (removed) extension = removed.ext
        }
        if (filtered.length === 0) delete altRefs.references[originalSha]
        else altRefs.references[originalSha] = filtered
        altRefsAsRef = true
        altRefsDirty = true
      }
    }
  }

  // Si seguimos sin saber la extensión, intentamos las habituales.
  // En orden de probabilidad por nuestro pipeline: .png (mayoría del banco
  // original), .jpg (refs Lens), .webp, .gif.
  const extensionsToTry = extension ? [extension] : ["png", "jpg", "jpeg", "webp", "gif"]

  // ── 3. Persistir JSONs limpios en paralelo ──────────────────────
  const writes: Promise<unknown>[] = []
  if (classificationDirty) writes.push(putJsonToR2(R2_META_KEYS.classification,        classification!))
  if (confirmationsDirty)  writes.push(putJsonToR2(R2_META_KEYS.tagConfirmations,      confirmations!))
  if (exclusionsDirty)     writes.push(putJsonToR2(R2_META_KEYS.tagExclusions,         exclusions!))
  if (manualTagsDirty)     writes.push(putJsonToR2(R2_META_KEYS.manualTags,            manualTags!))
  if (altRefsDirty)        writes.push(putJsonToR2(R2_META_KEYS.alternativeReferences, altRefs!))
  try {
    await Promise.all(writes)
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Falló al limpiar metadata: ${err instanceof Error ? err.message : err}` },
      { status: 500 },
    )
  }

  // ── 4. Borrar binarios de R2 (todas las extensiones candidatas) ──
  const { client, bucket } = getR2Client()
  let deletedFromR2 = false
  for (const ext of extensionsToTry) {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `${sha}.${ext}` }))
      deletedFromR2 = true
      // R2 DeleteObject NO devuelve error si la key no existía — solo
      // marca el borrado. Si conocíamos la extensión exacta, paramos
      // tras la primera. Si era fuerza bruta, también paramos al
      // primer success silencioso (no podemos distinguir).
      if (extension) break
    } catch {
      // Si una ext falla, probamos la siguiente (caso fuerza bruta).
    }
  }

  // ── 5. Si force + preguntas afectadas, vaciar Question.imagen ───
  let questionsNulled = 0
  if (force && affectedQuestions.length > 0) {
    try {
      const r = await db.question.updateMany({
        where: { imagen: { startsWith: sha } },
        data:  { imagen: null },
      })
      questionsNulled = r.count
    } catch (err) {
      // No es fatal — la imagen ya está borrada de R2. Avisamos en la
      // respuesta y el admin reintenta el null si quiere.
      return NextResponse.json(
        {
          ok:             true,                     // R2 + metadata ya están limpios
          deletedFromR2,
          metadataCleaned: {
            classification:    classificationDirty,
            confirmations:     confirmationsDirty,
            exclusions:        exclusionsDirty,
            manualTags:        manualTagsDirty,
            altRefsAsOriginal,
            altRefsAsRef,
          },
          questionsNulled: 0,
          warn:           `Question.imagen NULL falló: ${err instanceof Error ? err.message : err}. R2 + metadata SÍ se limpiaron.`,
        },
        { status: 207 },   // Multi-Status: éxito parcial
      )
    }
  }

  return NextResponse.json({
    ok:             true,
    deletedFromR2,
    metadataCleaned: {
      classification:    classificationDirty,
      confirmations:     confirmationsDirty,
      exclusions:        exclusionsDirty,
      manualTags:        manualTagsDirty,
      altRefsAsOriginal,
      altRefsAsRef,
    },
    questionsNulled,
  })
}
