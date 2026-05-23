/**
 * One-shot script para automatizar TODA la migración de imágenes a R2:
 *
 *   1. Lista cuentas de Cloudflare (toma la primera o usa CF_ACCOUNT_ID)
 *   2. Crea bucket `dgt-tests-images` (si no existe)
 *   3. Activa public dev URL del bucket (r2.dev)
 *   4. Crea R2 API token con scope object:write para el bucket
 *   5. Sube las 2.646 PNG via S3 SDK
 *   6. Imprime la URL pública final + credenciales R2
 *
 * Requiere SOLO `CLOUDFLARE_API_TOKEN` en .env.local. El token debe
 * tener permiso "Cloudflare R2:Edit" (account-scoped).
 *
 * Generarlo en https://dash.cloudflare.com/profile/api-tokens
 *
 * Uso:
 *   npm run images:setup-r2
 */
import { readdir, readFile, stat } from "node:fs/promises"
import { join, extname, basename } from "node:path"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"

const CF_API   = "https://api.cloudflare.com/client/v4"
const IMAGES_DIR = join(process.cwd(), "public", "images")
const BATCH_SIZE = 20
const VALID_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"])
const BUCKET_NAME = process.env.R2_BUCKET_NAME ?? "dgt-tests-images"

interface CFResponse<T> {
  success: boolean
  errors: { code: number; message: string }[]
  messages: unknown[]
  result: T
}

interface Account { id: string; name: string }
interface Bucket  { name: string; creation_date: string }

async function cf<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type":  "application/json",
      ...init.headers,
    },
  })
  const data = (await res.json()) as CFResponse<T>
  if (!data.success) {
    const msgs = data.errors?.map((e) => `${e.code}: ${e.message}`).join(" · ") ?? "unknown"
    throw new Error(`CF API ${path} failed → ${msgs}`)
  }
  return data.result
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
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (!token) {
    console.error("❌ Falta CLOUDFLARE_API_TOKEN en .env.local")
    console.error("   Crear en https://dash.cloudflare.com/profile/api-tokens")
    console.error("   Custom token con permission: Account · Cloudflare R2:Edit")
    process.exit(1)
  }

  // ── 1. Resolver account_id ─────────────────────────────────────────
  let accountId = process.env.CF_ACCOUNT_ID
  if (!accountId) {
    console.log("🔎 Listando cuentas Cloudflare...")
    const accounts = await cf<Account[]>("/accounts", token)
    if (accounts.length === 0) {
      console.error("❌ El token no tiene acceso a ninguna cuenta")
      process.exit(1)
    }
    if (accounts.length > 1) {
      console.log("⚠ Múltiples cuentas, usando la primera:")
      accounts.forEach((a) => console.log(`   - ${a.id}  ${a.name}`))
    }
    accountId = accounts[0].id
    console.log(`✓ Account: ${accountId}  (${accounts[0].name})\n`)
  }

  // ── 2. Crear bucket si no existe ───────────────────────────────────
  console.log(`📦 Comprobando bucket "${BUCKET_NAME}"...`)
  const buckets = await cf<{ buckets: Bucket[] }>(`/accounts/${accountId}/r2/buckets`, token)
  const exists = buckets.buckets.some((b) => b.name === BUCKET_NAME)
  if (exists) {
    console.log(`✓ Bucket ya existe\n`)
  } else {
    console.log(`+ Creando bucket en EEUR (Europe West)...`)
    await cf(`/accounts/${accountId}/r2/buckets`, token, {
      method: "POST",
      body:   JSON.stringify({ name: BUCKET_NAME, locationHint: "weur" }),
    })
    console.log(`✓ Bucket creado\n`)
  }

  // ── 3. Activar public dev URL (managed) ───────────────────────────
  console.log(`🌐 Activando public r2.dev URL...`)
  let publicUrl: string
  try {
    const mng = await cf<{ bucketId: string; domain: string; enabled: boolean }>(
      `/accounts/${accountId}/r2/buckets/${BUCKET_NAME}/domains/managed`,
      token,
      { method: "PUT", body: JSON.stringify({ enabled: true }) },
    )
    publicUrl = `https://${mng.domain}`
    console.log(`✓ Public URL: ${publicUrl}\n`)
  } catch (err) {
    // Si falla, intenta leer la URL existente
    console.log(`  (no pude habilitarlo, leyendo URL existente: ${err instanceof Error ? err.message : err})`)
    const mng = await cf<{ bucketId: string; domain: string; enabled: boolean }>(
      `/accounts/${accountId}/r2/buckets/${BUCKET_NAME}/domains/managed`,
      token,
    )
    publicUrl = `https://${mng.domain}`
    console.log(`✓ Public URL: ${publicUrl} (enabled=${mng.enabled})\n`)
  }

  // ── 4. Crear R2 API token con scope object:write ───────────────────
  // El token de CF API no se puede usar directamente para subir objetos
  // al endpoint S3 de R2. Hay que generar un par access_key/secret R2.
  console.log(`🔑 Creando R2 API token (object:write para "${BUCKET_NAME}")...`)
  const r2Token = await cf<{
    accessKeyId: string
    secretAccessKey: string
    tokenId: string
  }>(
    `/accounts/${accountId}/r2/temp-access-credentials`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        bucket:    BUCKET_NAME,
        ttlSeconds: 3600, // 1h temp creds, más que suficiente para upload
        permission: "object-read-and-write",
      }),
    },
  )
  console.log(`✓ Creds R2 temporales obtenidas\n`)

  // ── 5. Subir imágenes via S3 API ───────────────────────────────────
  let files: string[]
  try {
    files = (await readdir(IMAGES_DIR)).filter((f) => VALID_EXTS.has(extname(f).toLowerCase()))
  } catch (err) {
    console.error(`❌ No pude leer ${IMAGES_DIR}:`, err instanceof Error ? err.message : err)
    process.exit(1)
  }

  if (files.length === 0) {
    console.log(`📁 No hay imágenes en ${IMAGES_DIR}. ¿Ya las borraste?`)
    process.exit(0)
  }

  console.log(`📤 Subiendo ${files.length} imágenes al bucket en batches de ${BATCH_SIZE}...`)
  const s3 = new S3Client({
    region:   "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     r2Token.accessKeyId,
      secretAccessKey: r2Token.secretAccessKey,
    },
  })

  const stats = { uploaded: 0, failed: 0, totalBytes: 0 }
  const startTs = Date.now()

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(async (filename) => {
      const fullPath = join(IMAGES_DIR, filename)
      try {
        const [buf, st] = await Promise.all([readFile(fullPath), stat(fullPath)])
        await s3.send(new PutObjectCommand({
          Bucket:       BUCKET_NAME,
          Key:          basename(filename),
          Body:         buf,
          ContentType:  mimeFromExt(extname(filename)),
          CacheControl: "public, max-age=31536000, immutable",
        }))
        stats.uploaded++
        stats.totalBytes += st.size
      } catch (err) {
        stats.failed++
        console.error(`\n  ❌ ${filename}: ${err instanceof Error ? err.message : err}`)
      }
    }))
    const done = Math.min(i + BATCH_SIZE, files.length)
    const pct = Math.round((done / files.length) * 100)
    process.stdout.write(`\r  ${done}/${files.length} (${pct}%) · OK: ${stats.uploaded} · errores: ${stats.failed}`)
  }

  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1)
  const mb = (stats.totalBytes / 1024 / 1024).toFixed(1)
  console.log(`\n\n✅ Upload completado en ${elapsed}s — ${stats.uploaded} imágenes (${mb} MB)`)
  if (stats.failed > 0) {
    console.log(`⚠ ${stats.failed} fallos`)
  }

  // ── 6. Verificar con un fetch ──────────────────────────────────────
  const testFile = files[0]
  console.log(`\n🔍 Verificando público: ${publicUrl}/${testFile}`)
  try {
    const res = await fetch(`${publicUrl}/${testFile}`, { method: "HEAD" })
    if (res.ok) {
      console.log(`✓ HTTP ${res.status} · ${res.headers.get("content-type")} · ${res.headers.get("content-length")}b`)
    } else {
      console.log(`⚠ HTTP ${res.status} — pueden tardar unos minutos en propagar`)
    }
  } catch (err) {
    console.log(`⚠ Fetch falló: ${err instanceof Error ? err.message : err}`)
  }

  // ── 7. Output final ────────────────────────────────────────────────
  console.log("\n📌 Configuración para .env.local y Vercel:")
  console.log(`   NEXT_PUBLIC_IMAGE_CDN_URL="${publicUrl}"`)
  console.log("\n📌 Próximos pasos:")
  console.log("   1. Pega esa línea en .env.local + Vercel project envs")
  console.log("   2. Reinicia dev server y verifica que las imgs de tests cargan")
  console.log("   3. Borra public/images/ del repo + commit cleanup (yo lo hago)")
}

main().catch((err) => {
  console.error("\n💥 Error fatal:", err instanceof Error ? err.message : err)
  process.exit(1)
})
