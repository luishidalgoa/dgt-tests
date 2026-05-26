/**
 * Descarga TODAS las imágenes del bucket R2 a `public/images/`.
 *
 * Es el espejo de `upload-images-to-r2.ts`: usa las mismas credenciales
 * (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME)
 * pero al revés — ListObjectsV2 + GetObject en lugar de PutObject.
 *
 * Para qué: bajar el banco completo a local antes de correr el audit
 * (SHA-256, pHash, clasificación). Necesario porque las imágenes ya no
 * viven en `public/images/` (están en R2 desde Fase 3 para no inflar el
 * deploy de Vercel) y los scripts de análisis necesitan los binarios.
 *
 * Idempotente: si una imagen ya existe localmente con el mismo tamaño,
 * la salta. Para forzar redescarga total: `FORCE=1 npm run images:download-r2`.
 *
 * Uso:
 *   npm run images:download-r2
 *
 * Performance: paraleliza en batches de 20. ~130 MB típicos descargan en
 * ~1-2 min en conexión doméstica decente. R2 no cobra egress (es la gran
 * ventaja vs S3) así que tirar de aquí es gratis.
 */
import { mkdir, writeFile, stat as statFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { S3Client, ListObjectsV2Command, GetObjectCommand, type _Object } from "@aws-sdk/client-s3"

const TARGET_DIR = join(process.cwd(), "public", "images")
const BATCH_SIZE = 20
const FORCE      = process.env.FORCE === "1"

interface Stats {
  downloaded: number
  skipped:    number
  failed:     number
  totalBytes: number
}

async function listAllObjects(s3: S3Client, bucket: string): Promise<_Object[]> {
  // R2 / S3 devuelve hasta 1000 objects por página. Paginamos con
  // ContinuationToken hasta vaciar el bucket.
  const all: _Object[] = []
  let continuationToken: string | undefined
  let page = 0

  do {
    page++
    process.stdout.write(`\r🔍 Listando objetos (página ${page}, ${all.length} hasta ahora)...`)
    const res = await s3.send(new ListObjectsV2Command({
      Bucket:            bucket,
      ContinuationToken: continuationToken,
    }))
    if (res.Contents) all.push(...res.Contents)
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (continuationToken)

  process.stdout.write(`\r🔍 Listados ${all.length} objetos en ${page} páginas      \n`)
  return all
}

async function downloadOne(
  s3:       S3Client,
  bucket:   string,
  obj:      _Object,
  stats:    Stats,
): Promise<void> {
  const key = obj.Key
  if (!key) return
  const localPath = join(TARGET_DIR, key)

  // Skip si ya existe local con mismo size (idempotencia básica).
  // Comparar bytes exactos sería más seguro pero leer ~130MB para chequear
  // siempre es desperdicio — el size casi nunca falla como heurística.
  if (!FORCE && existsSync(localPath)) {
    try {
      const local = await statFile(localPath)
      if (typeof obj.Size === "number" && local.size === obj.Size) {
        stats.skipped++
        return
      }
    } catch {
      // si statFile falla, simplemente seguimos a descargar
    }
  }

  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    if (!res.Body) throw new Error("Body vacío")
    // transformToByteArray() es helper del SDK v3 — colecta el stream
    // entero a Uint8Array. Para 130MB total en 2.6k archivos pequeños va
    // sobrado de memoria.
    const bytes = await res.Body.transformToByteArray()
    await writeFile(localPath, bytes)
    stats.downloaded++
    stats.totalBytes += bytes.length
  } catch (err) {
    stats.failed++
    console.error(`\n  ❌ ${key}: ${err instanceof Error ? err.message : err}`)
  }
}

async function main() {
  // ── Validar credenciales ────────────────────────────────────────────
  const accountId       = process.env.R2_ACCOUNT_ID
  const accessKeyId     = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket          = process.env.R2_BUCKET_NAME

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    console.error("❌ Faltan credenciales R2. Define en .env (o .env.local):")
    console.error("   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME")
    console.error("\nLas mismas que usa `images:upload-r2`. Si las tienes guardadas")
    console.error("en /admin/secrets pero no en .env, puedes copiarlas temporalmente")
    console.error("de Cloudflare → R2 → Manage R2 API Tokens.")
    process.exit(1)
  }

  console.log(`☁  Descargando de R2 bucket: ${bucket}`)
  console.log(`📁 Destino: ${TARGET_DIR}`)
  if (FORCE) console.log(`⚠  FORCE=1 → redescarga todos los archivos aunque existan`)
  console.log()

  // ── Asegurar carpeta destino ────────────────────────────────────────
  await mkdir(TARGET_DIR, { recursive: true })

  // ── Cliente R2 (S3 SDK con endpoint custom) ─────────────────────────
  const s3 = new S3Client({
    region:      "auto",
    endpoint:    `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })

  // ── 1) Listar todo el bucket ────────────────────────────────────────
  const objects = await listAllObjects(s3, bucket)
  if (objects.length === 0) {
    console.log("📁 El bucket está vacío. ¿Es el bucket correcto?")
    process.exit(0)
  }

  // ── 2) Descargar en batches ─────────────────────────────────────────
  console.log(`\n⬇  Descargando en batches de ${BATCH_SIZE}...`)
  const stats: Stats = { downloaded: 0, skipped: 0, failed: 0, totalBytes: 0 }
  const startTs = Date.now()

  for (let i = 0; i < objects.length; i += BATCH_SIZE) {
    const batch = objects.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map((obj) => downloadOne(s3, bucket, obj, stats)))

    const done = Math.min(i + BATCH_SIZE, objects.length)
    const pct  = Math.round((done / objects.length) * 100)
    const mb   = (stats.totalBytes / 1024 / 1024).toFixed(1)
    process.stdout.write(
      `\r  ${done}/${objects.length} (${pct}%) · OK: ${stats.downloaded} · skip: ${stats.skipped} · err: ${stats.failed} · ${mb} MB`,
    )
  }

  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1)
  const mb      = (stats.totalBytes / 1024 / 1024).toFixed(1)

  console.log(`\n\n✅ Descarga completada en ${elapsed}s`)
  console.log(`   Descargadas:  ${stats.downloaded}`)
  console.log(`   Ya existían:  ${stats.skipped}`)
  console.log(`   Fallidas:     ${stats.failed}`)
  console.log(`   Total bytes:  ${mb} MB`)

  if (stats.failed > 0) {
    console.log(`\n⚠ Hubo ${stats.failed} fallos. Re-corre el script para reintentar (idempotente).`)
    process.exit(1)
  }

  console.log(`\n📌 Próximo paso:`)
  console.log(`   npm run images:audit-sha`)
}

main().catch((err) => {
  console.error("\n💥 Error fatal:", err)
  process.exit(1)
})
