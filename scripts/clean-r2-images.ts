/**
 * Borra TODAS las imágenes del bucket R2 dejando intacto el prefix
 * `meta/` (donde viven los JSONs del banco). Pensado para un cleanup
 * one-shot antes de re-subir las imágenes con sus nuevos nombres SHA.
 *
 * Por defecto es DRY-RUN. Para borrar de verdad pasa `--apply`.
 *
 * Uso:
 *   npm run images:clean-r2                # preview (no borra nada)
 *   npm run images:clean-r2 -- --apply     # borra de verdad
 *
 * Después típicamente:
 *   npm run images:upload-r2               # sube public/images/ con nombres SHA
 *
 * Implementación: ListObjectsV2 paginado para listar todo el bucket.
 * Filtra los `Key` que NO empiecen por "meta/". DeleteObjects en batches
 * de 1000 (límite S3/R2). No intentamos paralelizar batches — el rate
 * de DELETE es alto y no es un cuello de botella aquí.
 */
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand, type _Object } from "@aws-sdk/client-s3"

const META_PREFIX = "meta/"  // intocable — son los JSONs del banco
const BATCH_SIZE  = 1000     // límite del DeleteObjects de S3/R2

interface Args {
  apply: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  return { apply: argv.includes("--apply") }
}

async function listAllObjects(s3: S3Client, bucket: string): Promise<_Object[]> {
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

async function main() {
  const { apply } = parseArgs()

  const accountId       = process.env.R2_ACCOUNT_ID
  const accessKeyId     = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket          = process.env.R2_BUCKET_NAME

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    console.error("❌ Faltan credenciales R2 en .env")
    process.exit(1)
  }

  const s3 = new S3Client({
    region:      "auto",
    endpoint:    `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })

  console.log(`☁  Bucket: ${bucket}`)
  console.log(`🛡  Protegido: prefix "${META_PREFIX}" (NO se toca)`)
  if (!apply) console.log(`🔍 DRY-RUN — no se borra nada. Pasa --apply para confirmar.\n`)
  else        console.log(`⚠  MODO APPLY — se BORRARÁN objetos de R2.\n`)

  const all = await listAllObjects(s3, bucket)
  if (all.length === 0) {
    console.log("📭 Bucket vacío — nada que hacer.")
    return
  }

  const toDelete = all.filter((o) => o.Key && !o.Key.startsWith(META_PREFIX))
  const protectedCount = all.length - toDelete.length

  console.log(`📊 Total objetos:           ${all.length}`)
  console.log(`   Protegidos (meta/):     ${protectedCount}`)
  console.log(`   A borrar:               ${toDelete.length}`)

  if (toDelete.length === 0) {
    console.log("\n✅ No hay objetos para borrar (todo está bajo meta/).")
    return
  }

  // Preview de los primeros 5
  console.log("\n  Primeros 5 a borrar:")
  for (const o of toDelete.slice(0, 5)) console.log(`    - ${o.Key}`)
  if (toDelete.length > 5) console.log(`    … y ${toDelete.length - 5} más`)

  if (!apply) {
    console.log("\n🔍 DRY-RUN terminado. Re-ejecuta con --apply para borrar.")
    return
  }

  // Borrar en batches de 1000
  let deleted = 0
  let failed  = 0
  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const batch = toDelete.slice(i, i + BATCH_SIZE)
    try {
      const res = await s3.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch.map((o) => ({ Key: o.Key! })),
          Quiet:   true,
        },
      }))
      deleted += batch.length - (res.Errors?.length ?? 0)
      if (res.Errors && res.Errors.length > 0) {
        failed += res.Errors.length
        for (const e of res.Errors.slice(0, 3)) {
          console.error(`  ✗ ${e.Key}: ${e.Code} ${e.Message}`)
        }
      }
    } catch (err) {
      failed += batch.length
      console.error(`  ❌ Batch ${i / BATCH_SIZE} FAILED:`, err instanceof Error ? err.message : err)
    }
    const done = Math.min(i + BATCH_SIZE, toDelete.length)
    process.stdout.write(`\r  ${done}/${toDelete.length} (${Math.round((done / toDelete.length) * 100)}%)`)
  }

  console.log(`\n\n✅ Cleanup completo.`)
  console.log(`   Borrados: ${deleted}`)
  if (failed > 0) console.log(`   ⚠ Fallos: ${failed}`)
  console.log(`\n📌 Próximo paso: npm run images:upload-r2`)
}

main().catch((err) => {
  console.error("\n💥 Error fatal:", err)
  process.exit(1)
})
