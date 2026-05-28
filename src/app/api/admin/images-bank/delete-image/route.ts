import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { requireAdmin } from "@/lib/adminGuard"
import { db } from "@/lib/db"
import {
  updateJsonInR2,
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

  // ── 2. Limpieza atómica de metadata JSONs en R2 (con CAS) ───────
  // Cada JSON se modifica con un read-modify-write condicional al ETag
  // leído (`updateJsonInR2` hace reintentos automáticos si otra request
  // escribió en medio). Resuelve la race condition donde dos deletes
  // concurrentes "revivían" entries que el otro había borrado.
  //
  // La extensión del binario se necesita para borrarlo de R2, así que
  // hacemos una primera lectura libre (sin CAS) para sacarla — incluso
  // si esta lectura es stale, el peor caso es intentar borrar con la
  // extensión equivocada (silent skip en R2). La verdad atómica vive
  // en los CAS de abajo.
  let extension: string | null = null
  let classificationDirty = false
  let confirmationsDirty  = false
  let exclusionsDirty     = false
  let manualTagsDirty     = false
  let altRefsAsOriginal   = false
  let altRefsAsRef        = false

  try {
    // 2a. classification.json — quita la entry + captura la extensión
    await updateJsonInR2<{ images?: Record<string, { filename: string }> }>(
      R2_META_KEYS.classification,
      (data) => {
        if (!data?.images?.[sha]) return data    // no change → no write
        const filename = data.images[sha].filename
        const dotIdx = filename.lastIndexOf(".")
        if (dotIdx >= 0 && !extension) extension = filename.slice(dotIdx + 1).toLowerCase()
        const next = { ...data, images: { ...data.images } }
        delete next.images[sha]
        classificationDirty = true
        return next
      },
    )

    // 2b. tag_confirmations.json
    await updateJsonInR2<{ confirmations?: Record<string, string[]> }>(
      R2_META_KEYS.tagConfirmations,
      (data) => {
        if (!data?.confirmations?.[sha]) return data
        const next = { ...data, confirmations: { ...data.confirmations } }
        delete next.confirmations[sha]
        confirmationsDirty = true
        return next
      },
    )

    // 2c. tag_exclusions.json
    await updateJsonInR2<{ exclusions?: Record<string, string[]> }>(
      R2_META_KEYS.tagExclusions,
      (data) => {
        if (!data?.exclusions?.[sha]) return data
        const next = { ...data, exclusions: { ...data.exclusions } }
        delete next.exclusions[sha]
        exclusionsDirty = true
        return next
      },
    )

    // 2d. manual_tags.json
    await updateJsonInR2<ManualTagsData>(
      R2_META_KEYS.manualTags,
      (data) => {
        if (!data?.entries?.[sha]) return data
        const next = { ...data, entries: { ...data.entries } }
        delete next.entries[sha]
        manualTagsDirty = true
        return next
      },
    )

    // 2e. alternative_references.json — sha puede ser:
    //   - originalSha (clave) → borrar la entry
    //   - newSha (item de algún array) → quitar el item
    await updateJsonInR2<AlternativeReferencesData>(
      R2_META_KEYS.alternativeReferences,
      (data) => {
        if (!data?.references) return data
        let changed = false
        const nextRefs: Record<string, typeof data.references[string]> = {}
        for (const [originalSha, arr] of Object.entries(data.references)) {
          if (originalSha === sha) {
            altRefsAsOriginal = true
            changed = true
            continue   // skip esta key entera
          }
          const before = arr.length
          const filtered = arr.filter((r) => {
            if (r.sha === sha) {
              if (!extension) extension = r.ext
              altRefsAsRef = true
              changed = true
              return false
            }
            return true
          })
          if (filtered.length === 0) {
            if (before > 0) changed = true
            continue   // skip si quedó vacío
          }
          nextRefs[originalSha] = filtered
        }
        if (!changed) return data
        return { ...data, references: nextRefs }
      },
    )
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Falló al limpiar metadata (CAS): ${err instanceof Error ? err.message : err}` },
      { status: 500 },
    )
  }

  // Si seguimos sin saber la extensión (caso: SHA huérfana sin entry en
  // ningún JSON), probamos todas las habituales del pipeline.
  const extensionsToTry = extension ? [extension] : ["png", "jpg", "jpeg", "webp", "gif"]

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
