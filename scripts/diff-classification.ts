/**
 * Compara `tools/image-audit/classification.json` (LOCAL, recién generado
 * por classify_siglip.py) con `meta/classification.json` en R2 (la versión
 * oficial de prod). Útil ANTES de hacer `npm run images:upload-metadata`
 * para detectar regresiones inesperadas.
 *
 * Reporta:
 *   - Stats globales comparativos (sin tag, sin confident, total)
 *   - Regresiones de feedback humano (CRÍTICO):
 *       · SHAs confirmadas (admin "SÍ es") cuyo tag no sale en el nuevo JSON
 *       · Exclusiones (admin "NO es") que se colaron en tags del nuevo JSON
 *   - Top labels con mayor cambio de conteo (sube/baja)
 *   - Sample de SHAs cuyo tag principal cambió
 *   - Verdict automático (✅ OK / ⚠ Warnings / ❌ NO SUBIR si bugs graves)
 *
 * Uso:
 *   npm run images:diff-classification
 *
 * Workflow recomendado:
 *   npm run images:download-metadata      # sincroniza tag_confirmations etc.
 *   npm run images:classify -- --force    # corre classifier local
 *   npm run images:diff-classification    # VALIDA antes de subir
 *   npm run images:upload-metadata        # solo si el diff sale OK
 */
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { getJsonFromR2, R2_META_KEYS } from "@/lib/imagesBankR2"

const LOCAL_PATH = join(process.cwd(), "tools", "image-audit", "classification.json")

// ── Tipos mínimos (solo lo que necesitamos) ──────────────────────────
interface ImageEntry {
  filename:        string
  tags:            Array<{ tag: string; score: number; confident: boolean; humanConfirmed?: boolean }>
  allScores?:      Record<string, number>
}

interface ClassificationJson {
  generatedAt:      string
  backend?:         string
  imagesProcessed?: number
  images:           Record<string, ImageEntry>
}

interface ConfMap {
  generatedAt?:   string
  confirmations?: Record<string, string[]>
}

interface ExclMap {
  generatedAt?: string
  exclusions?:  Record<string, string[]>
}

// ── Helpers ──────────────────────────────────────────────────────────
function pad(n: number, w = 6): string {
  return String(n).padStart(w)
}

function deltaStr(remote: number, local: number): string {
  const d = local - remote
  if (d === 0) return "="
  return d > 0 ? `+${d}` : `${d}`
}

function countTagsByLabel(imgs: ImageEntry[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const img of imgs) {
    for (const t of img.tags) {
      out.set(t.tag, (out.get(t.tag) ?? 0) + 1)
    }
  }
  return out
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n📊 Diff: classification.json LOCAL vs R2\n`)

  // ── 1. Leer JSON local ─────────────────────────────────────────────
  let local: ClassificationJson
  try {
    const raw = await readFile(LOCAL_PATH, "utf-8")
    local = JSON.parse(raw) as ClassificationJson
  } catch (err) {
    console.error(`❌ No pude leer ${LOCAL_PATH}`)
    console.error(`   ¿Has corrido el classifier local antes? (npm run images:classify)`)
    console.error(`   Error: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }

  // ── 2. Leer JSON remoto + feedback ─────────────────────────────────
  const remote = await getJsonFromR2<ClassificationJson>(R2_META_KEYS.classification)
  if (!remote) {
    console.log(`⚠  No hay classification.json en R2 — esto sería un primer subida.`)
    console.log(`   Cero regresiones detectables. Para subir sin comparación:`)
    console.log(`     npm run images:upload-metadata`)
    process.exit(0)
  }

  const conf = (await getJsonFromR2<ConfMap>(R2_META_KEYS.tagConfirmations)) ?? { confirmations: {} }
  const excl = (await getJsonFromR2<ExclMap>(R2_META_KEYS.tagExclusions))    ?? { exclusions: {} }

  console.log(`   local generated:   ${local.generatedAt ?? "?"}`)
  console.log(`   local backend:     ${local.backend ?? "(unknown)"}`)
  console.log(`   remote generated:  ${remote.generatedAt ?? "?"}`)
  console.log(`   remote backend:    ${remote.backend ?? "(unknown)"}\n`)

  // Si local y remote son IDÉNTICOS, casi seguro el user solo hizo
  // download-metadata sin correr classify local. Avisamos en vez de
  // confundir con un diff "todo igual".
  const sameGenerated = local.generatedAt && local.generatedAt === remote.generatedAt
  if (sameGenerated) {
    console.log(`⚠  local.generatedAt === remote.generatedAt`)
    console.log(`   El JSON local es idéntico al de R2 — probablemente solo hiciste`)
    console.log(`   'download-metadata' sin correr 'classify' local todavía. El diff`)
    console.log(`   no tiene nada nuevo del classifier que comparar, solo detectará`)
    console.log(`   asincronía con tag_confirmations/exclusions (swipes posteriores).\n`)
  }

  // ── 3. Stats globales ──────────────────────────────────────────────
  const localImgs        = Object.values(local.images ?? {})
  const remoteImgs       = Object.values(remote.images ?? {})
  const localNoTags      = localImgs.filter((i) => i.tags.length === 0).length
  const remoteNoTags     = remoteImgs.filter((i) => i.tags.length === 0).length
  const localNoConf      = localImgs.filter((i) => !i.tags.some((t) => t.confident)).length
  const remoteNoConf     = remoteImgs.filter((i) => !i.tags.some((t) => t.confident)).length
  const localHumConfHits = localImgs.reduce((s, i) => s + i.tags.filter((t) => t.humanConfirmed).length, 0)
  const remoteHumConfHits = remoteImgs.reduce((s, i) => s + i.tags.filter((t) => t.humanConfirmed).length, 0)

  console.log(`📊 Stats globales:`)
  console.log(`                                      remote → local       (delta)`)
  console.log(`   total images:                   ${pad(remoteImgs.length)}  →  ${pad(localImgs.length)}    (${deltaStr(remoteImgs.length, localImgs.length)})`)
  console.log(`   sin tag alguno:                 ${pad(remoteNoTags)}  →  ${pad(localNoTags)}    (${deltaStr(remoteNoTags, localNoTags)})`)
  console.log(`   sin tag confident:              ${pad(remoteNoConf)}  →  ${pad(localNoConf)}    (${deltaStr(remoteNoConf, localNoConf)})`)
  console.log(`   tags con humanConfirmed flag:   ${pad(remoteHumConfHits)}  →  ${pad(localHumConfHits)}    (${deltaStr(remoteHumConfHits, localHumConfHits)})`)
  console.log()

  // ── 4. Regresiones de feedback humano ──────────────────────────────
  const confMap = conf.confirmations ?? {}
  let confKept = 0
  let confLost = 0
  const confLostSamples: string[] = []
  for (const [sha, tags] of Object.entries(confMap)) {
    const entry = local.images?.[sha]
    if (!entry) continue
    const localTagSet = new Set(entry.tags.map((t) => t.tag))
    for (const t of tags) {
      if (localTagSet.has(t)) confKept++
      else {
        confLost++
        if (confLostSamples.length < 12) {
          const inAllScores = entry.allScores?.[t]
          const note = inAllScores !== undefined ? `score ${inAllScores.toFixed(3)} — fuera de top-K` : "no en allScores"
          confLostSamples.push(`${sha.slice(0, 10)}…/${t}  (${note})`)
        }
      }
    }
  }

  const exclMap = excl.exclusions ?? {}
  let exclRespected = 0
  let exclLeaked = 0
  const exclLeakedSamples: string[] = []
  for (const [sha, tags] of Object.entries(exclMap)) {
    const entry = local.images?.[sha]
    if (!entry) continue
    const localTagSet = new Set(entry.tags.map((t) => t.tag))
    for (const t of tags) {
      if (!localTagSet.has(t)) exclRespected++
      else {
        exclLeaked++
        if (exclLeakedSamples.length < 12) {
          exclLeakedSamples.push(`${sha.slice(0, 10)}…/${t}`)
        }
      }
    }
  }

  const confTotal = confKept + confLost
  const confLostPct = confTotal > 0 ? (100 * confLost) / confTotal : 0
  console.log(`✅ Confirmaciones humanas (admin "SÍ es"):`)
  console.log(`   ${confKept} respetadas en el nuevo JSON, ${confLost} fuera del top-K (${confLostPct.toFixed(1)}% pérdida)`)
  if (confLost > 0) {
    console.log(`   ⚠  Sample de las perdidas (estaban confirmadas, ahora no salen en tags[]):`)
    for (const s of confLostSamples) console.log(`     - ${s}`)
  }
  console.log()

  // Detectar si las exclusiones son más nuevas que el classification.json.
  // Si exclusions.generatedAt > classification.generatedAt, las "leaked" son
  // swipes POSTERIORES al run del classifier — NO es bug, solo asincronía
  // que se resolverá en el próximo run.
  const localTs = local.generatedAt ? Date.parse(local.generatedAt) : 0
  const exclTs  = excl.generatedAt  ? Date.parse(excl.generatedAt)  : 0
  const exclIsNewerThanClassif = exclTs > localTs && localTs > 0

  // Caso 2: el classifier LOCAL usó un tag_exclusions.json del FILESYSTEM
  // que estaba desactualizado respecto al de R2. Verificamos comparando el
  // tag_exclusions LOCAL (filesystem) con el de R2 — si el local tiene
  // MENOS entradas, las "leaked" son swipes hechos en R2 después del
  // último download-metadata pero antes del classify local.
  let localExclTotal = 0
  let r2ExclTotal    = 0
  let exclLocalIsStale = false
  try {
    const localExclPath = join(process.cwd(), "tools", "image-audit", "tag_exclusions.json")
    const localExclRaw  = await readFile(localExclPath, "utf-8")
    const localExclJson = JSON.parse(localExclRaw) as ExclMap
    const localExclMap  = localExclJson.exclusions ?? {}
    localExclTotal = Object.values(localExclMap).reduce((s, t) => s + (Array.isArray(t) ? t.length : 0), 0)
    r2ExclTotal    = Object.values(excl.exclusions ?? {}).reduce((s, t) => s + (Array.isArray(t) ? t.length : 0), 0)
    if (r2ExclTotal > localExclTotal) {
      exclLocalIsStale = true
    }
  } catch {
    // sin tag_exclusions.json local — no podemos comparar; asumimos OK
  }

  console.log(`🚫 Exclusiones humanas (admin "NO es"):`)
  console.log(`   ${exclRespected} respetadas (NO aparecen en tags), ${exclLeaked} SE COLARON`)
  if (exclLeaked > 0) {
    if (exclIsNewerThanClassif) {
      console.log(`   ℹ️  Asincronía detectada por timestamps (NO es bug):`)
      console.log(`      tag_exclusions.json generatedAt: ${excl.generatedAt}`)
      console.log(`      classification.json generatedAt: ${local.generatedAt}`)
      console.log(`      Las exclusiones son MÁS NUEVAS que el classifier run — son swipes`)
      console.log(`      posteriores. Se resolverán al re-correr el classifier.`)
    } else if (exclLocalIsStale) {
      console.log(`   ℹ️  Asincronía local↔R2 detectada (NO es bug del pipeline):`)
      console.log(`      tag_exclusions.json LOCAL: ${localExclTotal} exclusiones`)
      console.log(`      tag_exclusions.json EN R2: ${r2ExclTotal} exclusiones`)
      console.log(`      El classifier LOCAL leyó el archivo del filesystem (que estaba`)
      console.log(`      desactualizado vs R2). Hubo swipes en el banco que no llegaron al`)
      console.log(`      local antes del classify.`)
      console.log(`      Fix: corre 'npm run images:download-metadata' ANTES de classify`)
      console.log(`      para sincronizar local con R2.`)
    } else {
      console.log(`   ❌ BUG GRAVE — estas exclusiones DEBERÍAN filtrarse pero aparecen:`)
      console.log(`      (timestamps de archivos R2 NO indican asincronía, y el local`)
      console.log(`      tag_exclusions tiene mismas/más entradas que R2)`)
    }
    console.log(`   Sample (${exclLeakedSamples.length}):`)
    for (const s of exclLeakedSamples) console.log(`     - ${s}`)
  }
  console.log()

  // ── 5. Top labels con más variación ────────────────────────────────
  const localCounts  = countTagsByLabel(localImgs)
  const remoteCounts = countTagsByLabel(remoteImgs)
  const allTags      = new Set<string>([...localCounts.keys(), ...remoteCounts.keys()])
  type TagDiff = { tag: string; local: number; remote: number; delta: number }
  const diffs: TagDiff[] = []
  for (const tag of allTags) {
    const l = localCounts.get(tag) ?? 0
    const r = remoteCounts.get(tag) ?? 0
    diffs.push({ tag, local: l, remote: r, delta: l - r })
  }
  diffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  console.log(`📈 Top 20 labels con más variación de conteo:`)
  console.log(`                          remote → local    (delta)`)
  for (const d of diffs.slice(0, 20)) {
    if (d.delta === 0) continue
    const sign = d.delta > 0 ? "+" : ""
    console.log(`   ${pad(d.remote, 5)} → ${pad(d.local, 5)}    (${sign}${d.delta.toString().padStart(4)})  ${d.tag}`)
  }
  console.log()

  // ── 6. SHAs cuyo tag principal cambió ──────────────────────────────
  let topTagChanges = 0
  const changeSamples: string[] = []
  for (const [sha, localEntry] of Object.entries(local.images ?? {})) {
    const remoteEntry = remote.images?.[sha]
    if (!remoteEntry) continue
    const localTop  = localEntry.tags[0]?.tag
    const remoteTop = remoteEntry.tags[0]?.tag
    if (localTop && remoteTop && localTop !== remoteTop) {
      topTagChanges++
      if (changeSamples.length < 15) {
        const ls = localEntry.tags[0]?.score?.toFixed(2)
        const rs = remoteEntry.tags[0]?.score?.toFixed(2)
        changeSamples.push(`${sha.slice(0, 10)}…  ${remoteTop} (${rs}) → ${localTop} (${ls})`)
      }
    }
  }
  console.log(`🔄 SHAs cuyo tag principal cambió: ${topTagChanges}`)
  if (changeSamples.length > 0) {
    console.log(`   Samples (top ${changeSamples.length}):`)
    for (const s of changeSamples) console.log(`     - ${s}`)
  }
  console.log()

  // ── 7. Verdict ─────────────────────────────────────────────────────
  console.log(`📋 Verdict:`)
  const issues: string[] = []
  if (exclLeaked > 0 && !exclIsNewerThanClassif && !exclLocalIsStale) {
    // Solo es BUG si no hay asincronía detectada (ni timestamps ni local↔R2)
    issues.push(`❌ ALARMA: ${exclLeaked} exclusiones humanas se colaron en tags[]. BUG en pipeline. NO SUBIR.`)
  } else if (exclLeaked > 0 && exclIsNewerThanClassif) {
    issues.push(`ℹ️  ${exclLeaked} exclusiones son swipes posteriores al último run del classifier. Se resolverán al re-correr classify. NO es un bug.`)
  } else if (exclLeaked > 0 && exclLocalIsStale) {
    issues.push(`ℹ️  ${exclLeaked} exclusiones son swipes que están en R2 pero no llegaron a tu local antes del classify. Fix: 'npm run images:download-metadata' + re-classify. NO es bug del pipeline.`)
  }
  if (sameGenerated && exclLeaked === 0 && confLost === 0) {
    issues.push(`ℹ️  Tu classification.json local es idéntico al de R2. Corre 'npm run images:classify --force' para generar uno nuevo y vuelve a diff-validar.`)
  }
  if (confLost > 0 && confLostPct > 30) {
    issues.push(`⚠  Pérdida alta de confirmaciones humanas (${confLostPct.toFixed(1)}% — ${confLost}/${confTotal}). Revisa los samples antes de subir.`)
  } else if (confLost > 5) {
    issues.push(`⚠  ${confLost} confirmaciones humanas no salen en el top-K del nuevo JSON. Esto puede ser OK si están en allScores pero fuera del top-K — revisa los samples.`)
  }
  const noConfDelta = localNoConf - remoteNoConf
  if (noConfDelta > Math.max(50, remoteNoConf * 0.20)) {
    issues.push(`⚠  Imgs sin tag confident creció notablemente (+${noConfDelta}). Posible regresión de cobertura.`)
  }
  const noTagsDelta = localNoTags - remoteNoTags
  if (noTagsDelta > Math.max(50, remoteNoTags * 0.20)) {
    issues.push(`⚠  Imgs sin ningún tag creció notablemente (+${noTagsDelta}). Revisa.`)
  }

  // Separar issues bloqueantes (❌) de warnings (⚠) de informativos (ℹ️)
  const blocking = issues.filter((i) => i.startsWith("❌"))
  const warnings = issues.filter((i) => i.startsWith("⚠"))
  const infos    = issues.filter((i) => i.startsWith("ℹ️"))

  if (blocking.length === 0 && warnings.length === 0) {
    if (infos.length > 0) {
      for (const i of infos) console.log(`   ${i}`)
      console.log()
    }
    console.log(`   ✅ No hay regresiones bloqueantes. Puedes subir con confianza:`)
    console.log(`      npm run images:upload-metadata`)
  } else {
    for (const i of blocking) console.log(`   ${i}`)
    for (const i of warnings) console.log(`   ${i}`)
    for (const i of infos)    console.log(`   ${i}`)
    console.log()
    if (blocking.length > 0) {
      console.log(`   🛑 Bloqueantes detectados. RESOLVER antes de subir.`)
    } else {
      console.log(`   Para subir igualmente (solo si entiendes los warnings):`)
      console.log(`      npm run images:upload-metadata`)
    }
  }
  console.log()
}

main().catch((err) => {
  console.error(`\n❌ Error fatal: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
