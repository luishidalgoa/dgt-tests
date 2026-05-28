/**
 * Borra referencias alternativas (refs descargadas por Lens / stock APIs)
 * con filtros granulares + control de seguridad por dry-run/--apply.
 *
 * Para cada entry filtrada del registry meta/alternative_references.json:
 *   1. Borra el binario de R2 (`<newSha>.<ext>`) — salvo que el mismo
 *      newSha esté usado como ref de OTRO originalSha tras el filtro
 *      (rara coincidencia: misma URL guardada bajo dos SHAs).
 *   2. Quita la entry del registry.
 *   3. Sube el registry actualizado a R2.
 *
 * Por seguridad SIEMPRE arranca en dry-run. Para borrar de verdad
 * tienes que pasar --apply.
 *
 * Filtros (combinables — AND lógico entre todos los que pases):
 *   --provider <id>     pixabay|pexels|unsplash|serpapi  (uno o varios separados por coma)
 *   --added-by <id>     username del admin o "bulk-save-references"
 *   --sha <hex>         solo refs descargadas a partir de este SHA original
 *   --since <ISO>       fecha ISO 8601 — borra refs descargadas DESPUÉS
 *                       de ese instante. Útil tras un bulk-save fallido:
 *                       --since 2026-05-28T13:00:00Z
 *   --all               sin filtros — borra TODAS las refs del registry
 *
 * Si no pasas ningún filtro y NO pasas --all, el script aborta para
 * evitar acidentes.
 *
 * Uso:
 *   npm run images:purge-refs -- --provider pixabay,pexels                   # dry-run lista
 *   npm run images:purge-refs -- --added-by bulk-save-references --apply     # borra de verdad
 *   npm run images:purge-refs -- --since 2026-05-28T13:00:00Z --apply        # las del último bulk
 *   npm run images:purge-refs -- --sha 1f2bdeffbb67… --apply                 # solo refs de UN original
 *   npm run images:purge-refs -- --all --apply                               # NUKE TODAS
 */

import {
  S3Client,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3"
import {
  getJsonFromR2,
  putJsonToR2,
  R2_META_KEYS,
  type AlternativeReference,
  type AlternativeReferencesData,
} from "@/lib/imagesBankR2"

interface ParsedArgs {
  providers:   Set<string>   // vacío = no filtra por provider
  addedBy:     string | null
  sha:         string | null  // originalSha
  since:       number | null  // ms timestamp
  all:         boolean
  apply:       boolean
}

function parseArgs(): ParsedArgs {
  const a = process.argv.slice(2)
  const get = (name: string): string | undefined => {
    const i = a.indexOf(name)
    return i >= 0 && i + 1 < a.length ? a[i + 1] : undefined
  }
  const has = (name: string): boolean => a.includes(name)

  const providersRaw = get("--provider")
  const providers   = new Set(
    providersRaw ? providersRaw.split(",").map((s) => s.trim()).filter(Boolean) : [],
  )

  const sinceRaw = get("--since")
  let since: number | null = null
  if (sinceRaw) {
    const t = Date.parse(sinceRaw)
    if (!Number.isFinite(t)) {
      console.error(`❌ --since "${sinceRaw}" no es una fecha ISO válida.`)
      process.exit(1)
    }
    since = t
  }

  return {
    providers,
    addedBy: get("--added-by") ?? null,
    sha:     get("--sha") ?? null,
    since,
    all:     has("--all"),
    apply:   has("--apply"),
  }
}

function matches(entry: AlternativeReference, originalSha: string, args: ParsedArgs): boolean {
  if (args.all) return true
  if (args.providers.size > 0 && !args.providers.has(entry.provider)) return false
  if (args.addedBy && entry.addedBy !== args.addedBy) return false
  if (args.sha && originalSha !== args.sha) return false
  if (args.since) {
    const t = Date.parse(entry.downloadedAt)
    if (!Number.isFinite(t) || t < args.since) return false
  }
  return true
}

function getR2Client(): { client: S3Client; bucket: string } {
  const account = process.env.R2_ACCOUNT_ID
  const key     = process.env.R2_ACCESS_KEY_ID
  const secret  = process.env.R2_SECRET_ACCESS_KEY
  const bucket  = process.env.R2_BUCKET_NAME
  if (!account || !key || !secret || !bucket) {
    console.error("❌ Faltan creds R2 en .env / .env.local (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME).")
    process.exit(1)
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

async function main() {
  const args = parseArgs()

  // Validación: o filtro o --all explícito. Sin nada → abort.
  const hasFilter = args.providers.size > 0 || args.addedBy || args.sha || args.since
  if (!hasFilter && !args.all) {
    console.error("❌ Tienes que pasar al menos un filtro o --all para borrar TODO.")
    console.error("   Ejemplo: --added-by bulk-save-references  // borra las del bulk script")
    console.error("   Ejemplo: --since 2026-05-28T13:00:00Z     // borra las descargadas tras esa hora")
    console.error("   Ejemplo: --provider pixabay,pexels        // borra solo las de stock APIs")
    process.exit(1)
  }

  // ── Cargar registry ─────────────────────────────────────────────
  const registry = await getJsonFromR2<AlternativeReferencesData>(R2_META_KEYS.alternativeReferences)
  if (!registry?.references) {
    console.log("ℹ  meta/alternative_references.json no existe o está vacío — nada que purgar.")
    return
  }

  // ── Identificar las entries que matchean el filtro ──────────────
  type Hit = { originalSha: string; entry: AlternativeReference }
  const hits: Hit[] = []
  for (const [originalSha, arr] of Object.entries(registry.references)) {
    for (const entry of arr) {
      if (matches(entry, originalSha, args)) {
        hits.push({ originalSha, entry })
      }
    }
  }

  if (hits.length === 0) {
    console.log("✅ Ningún match con los filtros — nada que borrar.")
    return
  }

  // Mostrar resumen del filtro aplicado
  console.log(`🔎 Filtros activos:`)
  if (args.all)                  console.log(`   --all (TODAS las refs)`)
  if (args.providers.size > 0)   console.log(`   --provider ${[...args.providers].join(",")}`)
  if (args.addedBy)              console.log(`   --added-by ${args.addedBy}`)
  if (args.sha)                  console.log(`   --sha ${args.sha}`)
  if (args.since)                console.log(`   --since ${new Date(args.since).toISOString()}`)
  console.log()
  console.log(`📊 Match: ${hits.length} refs a borrar de ${Object.keys(registry.references).length} originales`)
  console.log()

  // Breakdown por provider + por SHA original (top 5)
  const byProvider = new Map<string, number>()
  const bySha      = new Map<string, number>()
  for (const h of hits) {
    byProvider.set(h.entry.provider, (byProvider.get(h.entry.provider) ?? 0) + 1)
    bySha.set(h.originalSha,         (bySha.get(h.originalSha)         ?? 0) + 1)
  }
  console.log("   Por provider:")
  for (const [p, n] of [...byProvider.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${p.padEnd(12)} ${n}`)
  }
  const topShas = [...bySha.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  console.log()
  console.log(`   Top 5 originales con más refs a borrar (de ${bySha.size} en total):`)
  for (const [sha, n] of topShas) {
    console.log(`     ${sha.slice(0, 16)}…  ${n} refs`)
  }
  console.log()

  if (!args.apply) {
    console.log("⚠  DRY-RUN — no se ha borrado nada. Pasa --apply para borrar de verdad.")
    return
  }

  // ── Construir el registry sin las hits + identificar binarios huérfanos ──
  const hitSet = new Set(hits.map((h) => `${h.originalSha}::${h.entry.sha}`))
  const survivors: Record<string, AlternativeReference[]> = {}
  for (const [originalSha, arr] of Object.entries(registry.references)) {
    const kept = arr.filter((e) => !hitSet.has(`${originalSha}::${e.sha}`))
    if (kept.length > 0) survivors[originalSha] = kept
  }

  // Un newSha es "borrable" del bucket solo si NO sobrevive en ningún
  // originalSha del registry final (caso edge: misma URL guardada para
  // dos SHAs distintos — borrar el binario rompería la otra entry).
  const survivingNewShas = new Set<string>()
  for (const arr of Object.values(survivors)) {
    for (const e of arr) survivingNewShas.add(e.sha)
  }
  const binariesToDelete: { key: string }[] = []
  const seenKeys = new Set<string>()
  for (const h of hits) {
    if (survivingNewShas.has(h.entry.sha)) continue   // sigue vivo bajo otro original
    const key = `${h.entry.sha}.${h.entry.ext}`
    if (seenKeys.has(key)) continue                    // ya programada para borrar
    seenKeys.add(key)
    binariesToDelete.push({ key })
  }

  console.log(`🗑  Binarios R2 a borrar: ${binariesToDelete.length}`)
  console.log(`   Refs vivas tras la purga: ${Object.values(survivors).reduce((s, a) => s + a.length, 0)}`)
  console.log(`   Originales con refs aún: ${Object.keys(survivors).length}`)
  console.log()

  // ── Borrado en batch (S3 DeleteObjects soporta hasta 1000 keys/req) ──
  const { client, bucket } = getR2Client()
  let deletedCount = 0
  let failedCount  = 0
  const BATCH = 1000
  for (let i = 0; i < binariesToDelete.length; i += BATCH) {
    const chunk = binariesToDelete.slice(i, i + BATCH)
    try {
      const res = await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: chunk.map((b) => ({ Key: b.key })), Quiet: true },
      }))
      deletedCount += chunk.length
      if (res.Errors && res.Errors.length > 0) {
        failedCount += res.Errors.length
        deletedCount -= res.Errors.length
        for (const err of res.Errors.slice(0, 5)) {
          console.warn(`     ⚠  ${err.Key}: ${err.Code} — ${err.Message}`)
        }
      }
    } catch (err) {
      // Fallback: si DeleteObjects falla (raro), iterar uno a uno
      console.warn(`     ⚠  Batch fallido (${err instanceof Error ? err.message : err}) — fallback uno a uno`)
      for (const b of chunk) {
        try {
          await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: b.key }))
          deletedCount++
        } catch {
          failedCount++
        }
      }
    }
    console.log(`   batch ${i / BATCH + 1} · borrados ${Math.min(i + BATCH, binariesToDelete.length)}/${binariesToDelete.length}`)
  }

  // ── Subir el registry actualizado ──────────────────────────────
  const newRegistry: AlternativeReferencesData = {
    version:    registry.version ?? 1,
    references: survivors,
  }
  await putJsonToR2(R2_META_KEYS.alternativeReferences, newRegistry)

  console.log()
  console.log(`✅ Purga completa:`)
  console.log(`   Refs eliminadas:   ${hits.length}`)
  console.log(`   Binarios borrados: ${deletedCount}${failedCount > 0 ? ` (${failedCount} fallos)` : ""}`)
  console.log(`   Registry actualizado en R2 (${Object.keys(survivors).length} originales restantes).`)
  console.log()
  console.log(`📝 Nota: classification.json puede contener todavía tags de los SHAs borrados.`)
  console.log(`   Si quieres limpiarlos también, corre 'npm run images:classify-modal --force'`)
  console.log(`   o 'npm run images:classify --force' — el classifier reescribirá el JSON sin esos SHAs.`)
}

main().catch((err) => {
  console.error("❌ Error fatal:", err)
  process.exit(1)
})
