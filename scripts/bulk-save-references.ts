/**
 * Bulk-download de referencias visuales para el banco DGT.
 *
 * Para cada SHA del banco (los originales — no los que YA son refs):
 *   - Si tiene ≥5 refs → SKIP.
 *   - Si tiene <5 → busca candidatos vía Google Lens (SerpAPI, default)
 *     o stock APIs (Pexels + Pixabay), descarga los necesarios para
 *     llegar a 5 y los registra en meta/alternative_references.json.
 *
 * Persistencia incremental: el registry se sube a R2 TRAS CADA SHA
 * procesado. Si el script crashea (red, quota, KeyboardInterrupt) la
 * lectura de R2 en la próxima ejecución refleja el progreso real —
 * no necesitas estado externo. Re-ejecutarlo skipea los SHAs ya
 * completos automáticamente.
 *
 * Las imágenes se suben a R2 sin clasificar. El siguiente run del
 * classifier (npm run images:classify-modal) las recogerá como SHAs
 * huérfanos y les asignará tags.
 *
 * ⚠ CUOTA SERPAPI:
 *   Default usa Google Lens vía SerpAPI = 1 búsqueda por SHA. Free
 *   tier 100/mes, plan pago $50/mes 5000. El script muestra una
 *   estimación al inicio + aborta para confirmación si superas un
 *   umbral configurable (--yes-burn-serpapi para skipear).
 *
 * Uso:
 *   npm run images:bulk-save-refs                            # default: Google Lens, target 5, banco entero
 *   npm run images:bulk-save-refs -- --max-shas 10           # smoke test
 *   npm run images:bulk-save-refs -- --provider stock        # usa Pexels+Pixabay (free pero calidad menor)
 *   npm run images:bulk-save-refs -- --target 3              # target distinto a 5
 *   npm run images:bulk-save-refs -- --dry-run               # calcula qué descargaría sin hacerlo
 *   npm run images:bulk-save-refs -- --tagged-only           # solo SHAs con al menos 1 tag
 *   npm run images:bulk-save-refs -- --delay-ms 300          # pausa entre descargas
 *   npm run images:bulk-save-refs -- --yes-burn-serpapi      # NO pide confirmación aunque > 50 SHAs
 */

import { createHash } from "node:crypto"
import {
  getJsonFromR2,
  putJsonToR2,
  putBinaryToR2,
  R2_META_KEYS,
  type AlternativeReference,
  type AlternativeReferencesData,
} from "@/lib/imagesBankR2"
import {
  findFromProviders,
  type Candidate,
  type ImageType,
} from "@/lib/reverseImageSearch"
import { absoluteImageUrl } from "@/lib/imageUrl"
import { LABEL_METADATA } from "@/app/admin/images-bank/labelMetadata"

// ── Tipos del classification.json (subset que consumimos) ─────────────
interface ClassificationTag {
  tag:       string
  score:     number
  confident: boolean
}
interface ClassificationImage {
  filename:  string
  tags:      ClassificationTag[]
}
interface ClassificationData {
  images: Record<string, ClassificationImage>
}

// ── Args ──────────────────────────────────────────────────────────────
interface ParsedArgs {
  target:           number
  providerSet:      "stock" | "google"
  maxShas:          number
  dryRun:           boolean
  taggedOnly:       boolean
  delayMs:          number
  imageType:        ImageType
  yesBurnSerpapi:   boolean
}

/** Umbral por encima del cual el script pide confirmación antes de
 *  gastar la cuota SerpAPI. Calibrado al free tier (100 búsquedas/mes):
 *  si vas a hacer > 50, mejor que el admin confirme que de verdad
 *  quiere quemar la mitad de la cuota en un solo run. */
const SERPAPI_CONFIRM_THRESHOLD = 50

function parseArgs(): ParsedArgs {
  const a = process.argv.slice(2)
  const get = (name: string, fallback?: string): string | undefined => {
    const i = a.indexOf(name)
    return i >= 0 && i + 1 < a.length ? a[i + 1] : fallback
  }
  const has = (name: string): boolean => a.includes(name)

  const providerSetRaw = get("--provider", "google") ?? "google"
  if (providerSetRaw !== "stock" && providerSetRaw !== "google") {
    console.error(`❌ --provider inválido: ${providerSetRaw}. Usa "stock" o "google".`)
    process.exit(1)
  }

  return {
    target:         parseInt(get("--target", "5") ?? "5", 10),
    providerSet:    providerSetRaw as "stock" | "google",
    maxShas:        parseInt(get("--max-shas", "0") ?? "0", 10),  // 0 = todos
    dryRun:         has("--dry-run"),
    taggedOnly:     has("--tagged-only"),
    delayMs:        parseInt(get("--delay-ms", "500") ?? "500", 10),
    imageType:      "any",
    yesBurnSerpapi: has("--yes-burn-serpapi"),
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg":    "jpg",
  "image/jpg":     "jpg",
  "image/png":     "png",
  "image/webp":    "webp",
  "image/gif":     "gif",
}

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024   // 10 MB
const MIN_DOWNLOAD_BYTES = 1 * 1024            // 1 KB

const USER_AGENT = "Mozilla/5.0 (compatible; DGT-Tests-BulkBot/1.0)"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Top tag confident en español — mismo derivado que el endpoint
 *  find-replacements. Útil para Pexels/Pixabay (búsqueda por keyword).
 *  Para SerpAPI Lens este valor se ignora porque hay imageUrl. */
function inferKeyword(image: ClassificationImage): string | undefined {
  const confidentTags = image.tags.filter((t) => t.confident).sort((a, b) => b.score - a.score)
  const topTag = confidentTags[0] ?? image.tags[0]
  if (!topTag) return undefined
  const meta = LABEL_METADATA[topTag.tag]
  const raw = meta?.displayEs?.split("·")[0].trim() ?? topTag.tag.replace(/_/g, " ")
  return raw.replace(/[/]/g, " ").replace(/\s+/g, " ").trim()
}

/** Descarga binario con timeout + whitelist MIME + límites de tamaño.
 *  Devuelve null si falla (no tira excepción — el caller continúa). */
async function downloadBinary(url: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "image/*" },
      signal:  AbortSignal.timeout(20_000),
      redirect: "follow",
    })
    if (!res.ok) {
      console.warn(`     ⚠  HTTP ${res.status} en ${url.slice(0, 80)}`)
      return null
    }
    const ct = (res.headers.get("Content-Type") ?? "").toLowerCase().split(";")[0].trim()
    if (!ALLOWED_CONTENT_TYPES[ct]) {
      console.warn(`     ⚠  Content-Type ${ct} no permitido — skip`)
      return null
    }
    const arrayBuffer = await res.arrayBuffer()
    const bytes       = Buffer.from(arrayBuffer)
    if (bytes.length < MIN_DOWNLOAD_BYTES) {
      console.warn(`     ⚠  Demasiado pequeño (${bytes.length} bytes) — skip`)
      return null
    }
    if (bytes.length > MAX_DOWNLOAD_BYTES) {
      console.warn(`     ⚠  Demasiado grande (${(bytes.length / 1024 / 1024).toFixed(1)} MB) — skip`)
      return null
    }
    return { bytes, contentType: ct }
  } catch (err) {
    console.warn(`     ⚠  Download error: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs()
  if (args.target < 1 || args.target > 20) {
    console.error("❌ --target debe estar entre 1 y 20.")
    process.exit(1)
  }

  console.log(`🚀 Bulk-save references — target ${args.target} refs/imagen, provider=${args.providerSet}, delay=${args.delayMs}ms${args.dryRun ? ", DRY-RUN" : ""}${args.taggedOnly ? ", tagged-only" : ""}`)
  if (args.maxShas > 0) console.log(`   Limit: primeras ${args.maxShas} SHAs.`)
  console.log()

  // ── 1. Cargar estado actual desde R2 ─────────────────────────────
  console.log("📥 Cargando classification.json + alternative_references.json desde R2...")
  const [classification, registryExisting] = await Promise.all([
    getJsonFromR2<ClassificationData>(R2_META_KEYS.classification),
    getJsonFromR2<AlternativeReferencesData>(R2_META_KEYS.alternativeReferences),
  ])
  if (!classification?.images) {
    console.error("❌ classification.json no existe en R2. Corre el classifier primero.")
    process.exit(1)
  }
  const registry: AlternativeReferencesData = registryExisting ?? { version: 1, references: {} }

  // Set de SHAs que YA son refs descargadas anteriormente → las
  // excluimos como candidatos a recibir nuevas refs (no descargar refs
  // de una ref — sería cascada redundante).
  const isRefSet = new Set<string>()
  for (const arr of Object.values(registry.references)) {
    for (const r of arr) isRefSet.add(r.sha)
  }
  console.log(`   ${Object.keys(classification.images).length} SHAs en classification`)
  console.log(`   ${Object.keys(registry.references).length} originales con refs guardadas (${[...isRefSet].length} SHAs marcadas como ref)`)
  console.log()

  // ── 2. Construir cola de candidatos ─────────────────────────────
  type Queued = { sha: string; image: ClassificationImage; currentCount: number; needed: number; keyword?: string }
  const queue: Queued[] = []
  let skippedFull   = 0
  let skippedIsRef  = 0
  let skippedNoTags = 0

  for (const [sha, image] of Object.entries(classification.images)) {
    if (isRefSet.has(sha)) { skippedIsRef++; continue }
    const currentCount = registry.references[sha]?.length ?? 0
    if (currentCount >= args.target) { skippedFull++; continue }
    if (args.taggedOnly && image.tags.length === 0) { skippedNoTags++; continue }
    const keyword = inferKeyword(image)
    if (args.providerSet === "stock" && !keyword) { skippedNoTags++; continue }   // sin tag no podemos buscar por keyword
    queue.push({ sha, image, currentCount, needed: args.target - currentCount, keyword })
  }

  // Prioridad: las que más cerca están de target primero (las que ya
  // empezaste a llenar). Tras esas, alfabético por SHA para estabilidad.
  queue.sort((a, b) => {
    if (a.currentCount !== b.currentCount) return b.currentCount - a.currentCount
    return a.sha.localeCompare(b.sha)
  })

  const totalToProcess = args.maxShas > 0 ? Math.min(args.maxShas, queue.length) : queue.length
  const totalDownloadsExpected = queue.slice(0, totalToProcess).reduce((s, q) => s + q.needed, 0)

  console.log(`📊 Plan de trabajo:`)
  console.log(`   queue size:           ${queue.length} SHAs`)
  console.log(`   processed esta tanda: ${totalToProcess}${args.maxShas > 0 ? ` (limit --max-shas)` : ""}`)
  console.log(`   downloads esperados:  ~${totalDownloadsExpected} (suponiendo todos los providers devuelven candidatos suficientes)`)
  console.log(`   skips:                ${skippedFull} ya completos, ${skippedIsRef} son refs ellas mismas, ${skippedNoTags} sin tag (no buscables)`)
  console.log()

  // ── Aviso de cuota SerpAPI ──────────────────────────────────────
  // Google Lens consume 1 búsqueda SerpAPI por SHA. Si vamos a quemar
  // más de SERPAPI_CONFIRM_THRESHOLD del free tier (100/mes), pedimos
  // confirmación explícita. --yes-burn-serpapi salta el prompt.
  if (args.providerSet === "google" && totalToProcess > 0) {
    console.log(`💸 Coste SerpAPI estimado: ~${totalToProcess} búsquedas Lens`)
    console.log(`   Free tier:  100/mes  ·  Plan pago: 5000/mes ($50)`)
    if (totalToProcess > SERPAPI_CONFIRM_THRESHOLD && !args.yesBurnSerpapi && !args.dryRun) {
      console.log()
      console.log(`⚠  Vas a consumir ${totalToProcess} búsquedas de SerpAPI Lens (umbral ${SERPAPI_CONFIRM_THRESHOLD}).`)
      console.log(`   Opciones:`)
      console.log(`     a) Confirma con --yes-burn-serpapi`)
      console.log(`     b) Limita con --max-shas ${SERPAPI_CONFIRM_THRESHOLD} para gastar menos en esta tanda`)
      console.log(`     c) Usa --provider stock (Pexels+Pixabay, gratis pero calidad menor)`)
      console.log()
      console.log(`   Aborting — re-ejecuta con uno de los flags arriba para continuar.`)
      process.exit(2)
    }
    console.log()
  }

  if (args.dryRun) {
    console.log("✅ --dry-run: nada más que hacer. Quitas el flag para ejecutar de verdad.")
    return
  }

  if (totalToProcess === 0) {
    console.log("✅ Nada que descargar — todas las imágenes ya tienen el target alcanzado.")
    return
  }

  // ── 3. Procesar cola con persistencia tras cada SHA ─────────────
  const providerNames: string[] = args.providerSet === "stock" ? ["pixabay", "pexels"] : ["serpapi"]
  let totalSaved          = 0
  let totalDuplicates     = 0
  let totalFailed         = 0
  let shasProcessed       = 0
  let shasIncomplete      = 0   // SHAs donde saved < needed por agotamiento de candidates

  for (const q of queue.slice(0, totalToProcess)) {
    shasProcessed++
    const shaShort = q.sha.slice(0, 10)
    console.log(`[${shasProcessed}/${totalToProcess}] 🔍 ${shaShort}… · current=${q.currentCount}/${args.target} (need ${q.needed}) · keyword="${q.keyword ?? "(none)"}"`)

    // Pedimos MUCHOS más candidatos que `needed` para tener margen tras
    // filtrar duplicados (sourceUrl ya en registry), Content-Type inválido
    // (text/html, paginas que no son imgs), tamaños fuera de rango, etc.
    // SerpAPI Lens devuelve hasta ~50 visual_matches; el endpoint los
    // cropea al min(50, max).
    const searchMax = Math.min(50, q.needed * 6 + 8)
    let candidates: Candidate[]
    try {
      candidates = await findFromProviders(providerNames, {
        keyword:   q.keyword,
        imageUrl:  absoluteImageUrl(q.image.filename),
        max:       searchMax,
        imageType: args.imageType,
        lang:      "es",
      })
    } catch (err) {
      console.warn(`   ⚠  Provider error: ${err instanceof Error ? err.message : err} — skip SHA`)
      totalFailed++
      continue
    }

    if (candidates.length === 0) {
      console.warn(`   ⚠  Sin candidatos del provider — skip SHA`)
      continue
    }

    let savedHere = 0
    for (const cand of candidates) {
      if (savedHere >= q.needed) break

      // Dedup vs registry actual de TODOS los SHAs (no solo este — una
      // misma URL podría ya estar guardada como ref de otro original).
      const alreadyInRegistry = (() => {
        for (const arr of Object.values(registry.references)) {
          if (arr.some((r) => r.sourceUrl === cand.sourceUrl)) return true
        }
        return false
      })()
      if (alreadyInRegistry || cand.alreadyDownloaded) {
        totalDuplicates++
        continue
      }

      // Descarga binario
      const dl = await downloadBinary(cand.url)
      if (!dl) {
        totalFailed++
        continue
      }

      // Calcula SHA + sube a R2 + actualiza registry IN-MEMORY
      const newSha       = createHash("sha256").update(dl.bytes).digest("hex")
      const ext          = ALLOWED_CONTENT_TYPES[dl.contentType]
      const newFilename  = `${newSha}.${ext}`

      // Si por coincidencia el binario es bit-a-bit igual a la original,
      // no tiene sentido guardarlo (sería duplicado del propio sha).
      if (newSha === q.sha) {
        console.warn(`     ⚠  Candidato bit-a-bit idéntico al original (sha colisión) — skip`)
        continue
      }

      // Dedup por newSha dentro del mismo SHA original (lo hace el endpoint
      // save-reference; aquí lo replicamos para coherencia).
      const list = registry.references[q.sha] ?? []
      if (list.some((r) => r.sha === newSha)) {
        totalDuplicates++
        continue
      }

      try {
        await putBinaryToR2(newFilename, dl.bytes, dl.contentType)
      } catch (err) {
        console.warn(`     ⚠  R2 upload failed: ${err instanceof Error ? err.message : err} — skip`)
        totalFailed++
        continue
      }

      const entry: AlternativeReference = {
        sha:          newSha,
        ext,
        sourceUrl:    cand.sourceUrl ?? cand.url,
        provider:     cand.provider,
        attribution:  cand.attribution,
        downloadedAt: new Date().toISOString(),
        addedBy:      "bulk-save-references",
      }
      registry.references[q.sha] = [...list, entry]
      savedHere++
      totalSaved++

      console.log(`     ✅ ${cand.provider.padEnd(8)} → ${newSha.slice(0, 10)}… (${(dl.bytes.length / 1024).toFixed(0)} KB) · ${cand.attribution ?? "anon"}`)

      if (args.delayMs > 0) await sleep(args.delayMs)
    }

    // ── Persistir registry tras cada SHA (resilience) ──────────
    // Si el script crashea ahora, lo descargado para este SHA se ha
    // persistido. Re-ejecutar lo lee y skipea las que ya están al máximo.
    try {
      await putJsonToR2(R2_META_KEYS.alternativeReferences, registry)
    } catch (err) {
      console.error(`   ❌ Registry write failed: ${err instanceof Error ? err.message : err}`)
      console.error(`      ↑ TUS ÚLTIMAS ${savedHere} REFS QUEDARON HUÉRFANAS EN R2 sin registrar. Re-ejecuta para reintentar.`)
      process.exit(1)
    }

    // Marcar como incompleta si no se llegó al target tras agotar todos
    // los candidates. Útil para identificar SHAs donde el provider devolvió
    // pocos matches únicos. Re-ejecutar más adelante intentará otra vez
    // (los providers a veces devuelven listas distintas por imagen
    // popular vs nicho).
    if (savedHere < q.needed) {
      shasIncomplete++
      console.warn(`   ⚠  Solo ${savedHere}/${q.needed} guardadas — los ${candidates.length} candidates del provider no alcanzaron tras dedup/filtros. Re-ejecuta más tarde para reintentar.`)
    } else {
      console.log(`   ✓ ${savedHere}/${q.needed} guardadas para esta SHA · total acumulado: ${totalSaved}`)
    }
  }

  // ── 4. Resumen ─────────────────────────────────────────────────
  console.log()
  console.log("📊 Resumen final:")
  console.log(`   SHAs procesados:  ${shasProcessed}`)
  console.log(`   SHAs completas:   ${shasProcessed - shasIncomplete}`)
  console.log(`   SHAs incompletas: ${shasIncomplete}  ${shasIncomplete > 0 ? "← re-ejecuta para reintentar (los providers a veces devuelven listas distintas)" : ""}`)
  console.log(`   Refs guardadas:   ${totalSaved}`)
  console.log(`   Duplicados:       ${totalDuplicates}`)
  console.log(`   Fallos:           ${totalFailed}`)
  console.log()
  console.log("📝 Próximos pasos:")
  console.log("   - Corre `npm run images:classify-modal` para que el classifier etiquete las refs huérfanas.")
  console.log("   - Recarga /admin/images-bank → verás las nuevas como 'PENDIENTE' hasta el siguiente run del classifier.")
}

main().catch((err) => {
  console.error("❌ Error fatal:", err)
  process.exit(1)
})
