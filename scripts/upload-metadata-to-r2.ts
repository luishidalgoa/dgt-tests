/**
 * Sube los JSONs de metadata del banco de imágenes desde
 * `tools/image-audit/` al bucket R2 bajo prefix `meta/`.
 *
 * Por qué: el clasificador SigLIP corre en local (Python + GPU/CPU) y
 * escribe en disco. Las API routes en prod (Vercel) leen de R2, no de
 * disco. Este script es el "publish" tras correr el clasificador.
 *
 * Idempotente: PutObject sobreescribe. Si quieres pisar tag_exclusions
 * con un dump local, lo hace (¡cuidado con perder swipes que hizo el admin
 * en prod!). En el flujo normal, después del classifier que ya respeta
 * exclusiones, esto es seguro.
 *
 * Uso:
 *   npm run images:upload-metadata
 *
 * Lo que sube (skip silencioso si no existe el archivo en local):
 *   tools/image-audit/classification.json    → meta/classification.json
 *   tools/image-audit/sha-audit.json         → meta/sha-audit.json
 *   tools/image-audit/discovered_labels.json → meta/discovered_labels.json
 *   tools/image-audit/tag_exclusions.json    → meta/tag_exclusions.json
 *   tools/image-audit/tag_confirmations.json → meta/tag_confirmations.json
 */
import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"

const LOCAL_DIR = join(process.cwd(), "tools", "image-audit")

// Pares (filename local → key R2). Coincide con R2_META_KEYS en
// src/lib/imagesBankR2.ts — si cambias uno, cambia el otro.
const FILES: { localName: string; r2Key: string }[] = [
  { localName: "classification.json",         r2Key: "meta/classification.json" },
  { localName: "sha-audit.json",              r2Key: "meta/sha-audit.json" },
  { localName: "discovered_labels.json",      r2Key: "meta/discovered_labels.json" },
  { localName: "refined_labels.json",         r2Key: "meta/refined_labels.json" },
  { localName: "prototypes.json",             r2Key: "meta/prototypes.json" },
  { localName: "tag_exclusions.json",         r2Key: "meta/tag_exclusions.json" },
  { localName: "tag_confirmations.json",      r2Key: "meta/tag_confirmations.json" },
  { localName: "alternative_references.json", r2Key: "meta/alternative_references.json" },
  { localName: "manual_tags.json",            r2Key: "meta/manual_tags.json" },
]

async function main() {
  const accountId       = process.env.R2_ACCOUNT_ID
  const accessKeyId     = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket          = process.env.R2_BUCKET_NAME

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    console.error("❌ Faltan credenciales R2 en .env:")
    console.error("   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME")
    process.exit(1)
  }

  const s3 = new S3Client({
    region:      "auto",
    endpoint:    `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })

  console.log(`📦 Subiendo metadata del banco a R2 bucket: ${bucket}\n`)

  let uploaded = 0
  let skipped  = 0
  let failed   = 0
  let totalBytes = 0

  for (const { localName, r2Key } of FILES) {
    const localPath = join(LOCAL_DIR, localName)
    try {
      // Validar que existe — si no, skip silencioso (no es obligatorio
      // tener todos los JSONs).
      const st = await stat(localPath).catch(() => null)
      if (!st || !st.isFile()) {
        console.log(`  ⏭   ${localName.padEnd(30)} (no existe en local — skip)`)
        skipped++
        continue
      }

      const body = await readFile(localPath)
      await s3.send(new PutObjectCommand({
        Bucket:        bucket,
        Key:           r2Key,
        Body:          body,
        ContentType:   "application/json; charset=utf-8",
        CacheControl:  "no-cache",
      }))

      const kb = (st.size / 1024).toFixed(1)
      console.log(`  ✅  ${localName.padEnd(30)} → ${r2Key.padEnd(35)} (${kb} KB)`)
      uploaded++
      totalBytes += st.size
    } catch (err) {
      console.error(`  ❌  ${localName.padEnd(30)} FAILED: ${err instanceof Error ? err.message : err}`)
      failed++
    }
  }

  console.log(`\n📊 Subidos: ${uploaded}  Skipped: ${skipped}  Failed: ${failed}  Total: ${(totalBytes / 1024).toFixed(1)} KB`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error("❌ Error fatal:", err)
  process.exit(1)
})
