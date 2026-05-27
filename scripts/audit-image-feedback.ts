/**
 * Audita el feedback humano acumulado en el banco de imágenes.
 *
 * Lee directamente de R2 (no del filesystem local — que puede estar
 * desfasado) los dos JSONs de decisiones del admin:
 *   - meta/tag_confirmations.json  (admin dijo "SÍ es")
 *   - meta/tag_exclusions.json     (admin dijo "NO es")
 *
 * Reporta:
 *   - Total shas con feedback
 *   - Total tags confirmados / excluidos
 *   - Top 20 labels por confirmaciones (positivos)
 *   - Top 20 labels por exclusiones (negativos)
 *   - Distribución para decidir entre estrategias B vs C:
 *       cuántos labels tienen >= 5 / >= 10 / >= 30 confirmaciones
 *
 * Uso:
 *   npm run images:audit-feedback
 */
import { getJsonFromR2, R2_META_KEYS } from "@/lib/imagesBankR2"

interface TagMapJson {
  generatedAt?:   string
  confirmations?: Record<string, string[]>
  exclusions?:    Record<string, string[]>
}

function countByTag(map: Record<string, string[]>): Map<string, number> {
  const out = new Map<string, number>()
  for (const tags of Object.values(map) as string[][]) {
    for (const t of tags) {
      out.set(t, (out.get(t) ?? 0) + 1)
    }
  }
  return out
}

function topN(counts: Map<string, number>, n: number): [string, number][] {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
}

function distribution(counts: Map<string, number>, thresholds: number[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of thresholds) {
    out[`>= ${t}`] = Array.from(counts.values()).filter((c) => c >= t).length
  }
  return out
}

async function main() {
  console.log("📊 Auditoría de feedback humano (fuente: R2 directo)\n")

  const conf = await getJsonFromR2<TagMapJson>(R2_META_KEYS.tagConfirmations)
  const excl = await getJsonFromR2<TagMapJson>(R2_META_KEYS.tagExclusions)

  // ── Confirmaciones ────────────────────────────────────────────────
  const confMap = conf?.confirmations ?? {}
  const confShas = Object.keys(confMap).length
  const confTotal = (Object.values(confMap) as string[][]).reduce((s, v) => s + v.length, 0)
  console.log(`✅ Confirmaciones ("SÍ es"):`)
  console.log(`   ${confShas} shas distintas, ${confTotal} (sha, tag) confirmadas`)
  console.log(`   archivo R2: ${R2_META_KEYS.tagConfirmations}`)
  console.log(`   generatedAt: ${conf?.generatedAt ?? "(no existe)"}\n`)

  const confByTag = countByTag(confMap)
  console.log(`   Top 20 labels por confirmaciones:`)
  for (const [tag, n] of topN(confByTag, 20)) {
    console.log(`     ${String(n).padStart(4)}×  ${tag}`)
  }
  console.log()

  const confDist = distribution(confByTag, [3, 5, 10, 30, 50, 100])
  console.log(`   Distribución de labels por número de confirmaciones:`)
  for (const [k, v] of Object.entries(confDist)) {
    console.log(`     ${k.padEnd(8)} → ${v} labels`)
  }
  console.log(`   total labels distintos confirmados al menos 1×: ${confByTag.size}`)
  console.log()

  // ── Exclusiones ───────────────────────────────────────────────────
  const exclMap = excl?.exclusions ?? {}
  const exclShas = Object.keys(exclMap).length
  const exclTotal = (Object.values(exclMap) as string[][]).reduce((s, v) => s + v.length, 0)
  console.log(`🚫 Exclusiones ("NO es"):`)
  console.log(`   ${exclShas} shas distintas, ${exclTotal} (sha, tag) excluidas`)
  console.log(`   archivo R2: ${R2_META_KEYS.tagExclusions}`)
  console.log(`   generatedAt: ${excl?.generatedAt ?? "(no existe)"}\n`)

  const exclByTag = countByTag(exclMap)
  console.log(`   Top 20 labels por exclusiones:`)
  for (const [tag, n] of topN(exclByTag, 20)) {
    console.log(`     ${String(n).padStart(4)}×  ${tag}`)
  }
  console.log()

  const exclDist = distribution(exclByTag, [3, 5, 10, 30, 50, 100])
  console.log(`   Distribución de labels por número de exclusiones:`)
  for (const [k, v] of Object.entries(exclDist)) {
    console.log(`     ${k.padEnd(8)} → ${v} labels`)
  }
  console.log(`   total labels distintos excluidos al menos 1×: ${exclByTag.size}`)
  console.log()

  // ── Verdict para decidir B vs C ───────────────────────────────────
  const labelsReadyForB = Array.from(confByTag.entries()).filter(([, n]) => n >= 5).length
  const labelsReadyForC = Array.from(confByTag.entries()).filter(([, n]) => n >= 30).length

  console.log(`📋 Verdict para decidir entre B (refine prompts) y C (kNN):\n`)
  console.log(`   Labels con >= 5 confirmaciones (threshold B):   ${labelsReadyForB}`)
  console.log(`   Labels con >= 30 confirmaciones (threshold C):  ${labelsReadyForC}`)
  console.log()
  if (labelsReadyForC >= 5) {
    console.log(`   → Suficiente feedback para C tener efecto en al menos ${labelsReadyForC} labels.`)
    console.log(`     Recomendación: B + C juntos (paquete completo).`)
  } else if (labelsReadyForB >= 5) {
    console.log(`   → Feedback escaso pero alcanza para B en ${labelsReadyForB} labels.`)
    console.log(`     Recomendación: B primero, C cuando acumules más feedback.`)
  } else {
    console.log(`   → Feedback aún muy escaso (< 5 labels con 5+ confirmaciones).`)
    console.log(`     Recomendación: usa A unas semanas más, swipea bastante, vuelve a correr esto.`)
  }
}

main().catch((err) => {
  console.error("❌ Error:", err)
  process.exit(1)
})
