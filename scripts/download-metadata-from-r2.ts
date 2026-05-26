/**
 * Baja los JSONs de metadata del banco desde R2 a `tools/image-audit/`.
 *
 * Espejo de upload-metadata-to-r2.ts. Para qué:
 *   - El admin en prod hace swipes "no es" / "sí es" → se persisten en
 *     R2 (meta/tag_exclusions.json, meta/tag_confirmations.json).
 *   - Cuando vuelves a correr el clasificador en local, necesitas esos
 *     swipes para que el clasificador los respete en el siguiente run.
 *   - Este script descarga R2 → local antes de correr el clasificador.
 *
 * Flujo recomendado completo:
 *
 *     npm run images:download-r2          # imágenes binarias → public/images/
 *     npm run images:download-metadata    # JSONs (incl. swipes admin) → tools/image-audit/
 *     npm run images:classify             # clasifica respetando swipes
 *     npm run images:upload-metadata      # publica nuevos JSONs a R2 → prod
 *
 * Idempotente: sobreescribe los archivos locales. Si tienes cambios
 * locales sin commitear, los pierdes — commit antes si te importan.
 */
import { writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3"

const LOCAL_DIR = join(process.cwd(), "tools", "image-audit")

const FILES: { localName: string; r2Key: string }[] = [
  { localName: "classification.json",     r2Key: "meta/classification.json" },
  { localName: "sha-audit.json",          r2Key: "meta/sha-audit.json" },
  { localName: "discovered_labels.json",  r2Key: "meta/discovered_labels.json" },
  { localName: "tag_exclusions.json",     r2Key: "meta/tag_exclusions.json" },
  { localName: "tag_confirmations.json",  r2Key: "meta/tag_confirmations.json" },
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

  await mkdir(LOCAL_DIR, { recursive: true })

  console.log(`📥 Bajando metadata desde R2 bucket: ${bucket}\n`)

  let downloaded = 0
  let missing    = 0
  let failed     = 0
  let totalBytes = 0

  for (const { localName, r2Key } of FILES) {
    const localPath = join(LOCAL_DIR, localName)
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: r2Key }))
      const text = await res.Body?.transformToString()
      if (!text) {
        console.log(`  ⚠   ${localName.padEnd(30)} (key vacía en R2 — skip)`)
        missing++
        continue
      }
      await writeFile(localPath, text, "utf-8")
      const kb = (text.length / 1024).toFixed(1)
      console.log(`  ✅  ${r2Key.padEnd(35)} → ${localName.padEnd(30)} (${kb} KB)`)
      downloaded++
      totalBytes += text.length
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
      if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) {
        console.log(`  ⏭   ${localName.padEnd(30)} (no existe en R2 — skip)`)
        missing++
      } else {
        console.error(`  ❌  ${localName.padEnd(30)} FAILED: ${err instanceof Error ? err.message : err}`)
        failed++
      }
    }
  }

  console.log(`\n📊 Descargados: ${downloaded}  Sin existir: ${missing}  Failed: ${failed}  Total: ${(totalBytes / 1024).toFixed(1)} KB`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error("❌ Error fatal:", err)
  process.exit(1)
})
