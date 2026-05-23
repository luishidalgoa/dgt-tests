/**
 * Sube TODAS las imágenes de public/images/ al bucket de Cloudflare R2.
 *
 * One-shot script para la migración inicial. Idempotente: si ya existe
 * un objeto con el mismo nombre, lo sobreescribe (R2 hace overwrite por
 * defecto en PutObject).
 *
 * Requiere en .env:
 *   R2_ACCOUNT_ID         → tu account ID de Cloudflare
 *   R2_ACCESS_KEY_ID      → API token con scope R2 Object Read & Write
 *   R2_SECRET_ACCESS_KEY  → secret del token
 *   R2_BUCKET_NAME        → nombre del bucket (ej: "dgt-tests-images")
 *
 * Uso:
 *   npm run images:upload-r2
 *
 * Cómo obtener las credenciales:
 *   1. Cloudflare dashboard → R2 → Create bucket (público)
 *   2. R2 sidebar → "Manage R2 API Tokens" → Create API Token
 *      → Permissions: Object Read & Write
 *      → Specify buckets: solo el tuyo
 *      → TTL: forever (o el que prefieras)
 *   3. Copia "Access Key ID", "Secret Access Key" y account ID
 *
 * Después de upload exitoso:
 *   - Configura custom domain en Cloudflare → R2 → bucket → Settings
 *   - Set NEXT_PUBLIC_IMAGE_CDN_URL al dominio público
 *   - Borra public/images/ del repo (commit cleanup)
 *
 * Implementación: usa AWS S3 SDK porque R2 es S3-compatible. Sube en
 * batches de 20 en paralelo para no saturar conexión ni rate limit.
 */
import { readdir, readFile, stat } from "node:fs/promises"
import { join, extname, basename } from "node:path"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"

const IMAGES_DIR     = join(process.cwd(), "public", "images")
const BATCH_SIZE     = 20
const VALID_EXTS     = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"])

interface UploadStats {
  uploaded: number
  failed:   number
  skipped:  number
  totalBytes: number
}

function mimeFromExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".png":  return "image/png"
    case ".jpg":  return "image/jpeg"
    case ".jpeg": return "image/jpeg"
    case ".webp": return "image/webp"
    case ".gif":  return "image/gif"
    default:      return "application/octet-stream"
  }
}

async function main() {
  // ── Validar env vars ─────────────────────────────────────────────────
  const accountId       = process.env.R2_ACCOUNT_ID
  const accessKeyId     = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket          = process.env.R2_BUCKET_NAME

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    console.error("❌ Faltan credenciales R2. Define en .env:")
    console.error("   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME")
    process.exit(1)
  }

  // ── Listar imágenes ──────────────────────────────────────────────────
  let files: string[]
  try {
    files = (await readdir(IMAGES_DIR)).filter((f) => VALID_EXTS.has(extname(f).toLowerCase()))
  } catch (err) {
    console.error(`❌ No pude leer ${IMAGES_DIR}:`, err instanceof Error ? err.message : err)
    process.exit(1)
  }

  if (files.length === 0) {
    console.log("📁 No hay imágenes en public/images/. ¿Ya las borraste?")
    process.exit(0)
  }

  console.log(`📦 Encontradas ${files.length} imágenes en ${IMAGES_DIR}`)
  console.log(`☁  Subiendo a R2 bucket: ${bucket}`)
  console.log(`   En batches de ${BATCH_SIZE} en paralelo...\n`)

  // ── Cliente R2 (S3 SDK con endpoint custom) ──────────────────────────
  const s3 = new S3Client({
    region:   "auto",   // R2 ignora region, pero el SDK requiere valor
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })

  // ── Upload en batches ────────────────────────────────────────────────
  const stats: UploadStats = { uploaded: 0, failed: 0, skipped: 0, totalBytes: 0 }
  const startTs = Date.now()

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(async (filename) => {
      const fullPath = join(IMAGES_DIR, filename)
      try {
        const [buf, st] = await Promise.all([readFile(fullPath), stat(fullPath)])
        await s3.send(new PutObjectCommand({
          Bucket:       bucket,
          Key:          basename(filename),
          Body:         buf,
          ContentType:  mimeFromExt(extname(filename)),
          // 1 año cache — las imgs nunca cambian, solo se añaden nuevas.
          CacheControl: "public, max-age=31536000, immutable",
        }))
        stats.uploaded++
        stats.totalBytes += st.size
      } catch (err) {
        stats.failed++
        console.error(`  ❌ ${filename}: ${err instanceof Error ? err.message : err}`)
      }
    }))

    // Progress cada batch
    const done = Math.min(i + BATCH_SIZE, files.length)
    const pct  = Math.round((done / files.length) * 100)
    process.stdout.write(`\r  ${done}/${files.length} (${pct}%) · OK: ${stats.uploaded} · errores: ${stats.failed}`)
  }

  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1)
  const mb      = (stats.totalBytes / 1024 / 1024).toFixed(1)

  console.log(`\n\n✅ Subida completada en ${elapsed}s`)
  console.log(`   ${stats.uploaded} imágenes (${mb} MB)`)
  if (stats.failed > 0) {
    console.log(`   ⚠ ${stats.failed} fallos — revisa errores arriba`)
    process.exit(1)
  }

  console.log("\n📌 Próximos pasos:")
  console.log("   1. Configura custom domain (R2 → bucket → Settings → Custom Domains)")
  console.log("      o usa el .r2.dev URL si activaste 'Public Development URL'")
  console.log("   2. Set NEXT_PUBLIC_IMAGE_CDN_URL en .env y Vercel envs")
  console.log("   3. Verifica con: curl -I <URL>/<algún-filename>")
  console.log("   4. Cuando confirmes que funciona, borra public/images/ y commit")
}

main().catch((err) => {
  console.error("\n💥 Error fatal:", err)
  process.exit(1)
})
