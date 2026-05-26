/**
 * Audita las imágenes del banco DGT calculando SHA-256 por archivo y
 * agrupando los duplicados EXACTOS junto con las preguntas que los
 * referencian.
 *
 * Es la PRIMERA pasada del plan de banco de imágenes propio:
 *   1. (ESTE)  SHA-256 → cuántos archivos byte-idénticos hay
 *   2. (next)  pHash   → cuántos visualmente-iguales pero byte-distintos
 *   3. (next)  CLIP    → clasificar cada grupo único por tipo
 *
 * Output: `tools/image-audit/sha-audit.json` con esta estructura:
 *
 *   {
 *     "generatedAt":   "2026-05-25T10:30:00Z",
 *     "imagesDir":     "/abs/path/to/public/images",
 *     "totals": {
 *       "filesOnDisk":           2646,
 *       "totalSizeBytes":        45000000,
 *       "filesUsedInQuestions":  2200,
 *       "filesOrphan":           446,    // existen en disco, nadie las usa
 *       "filesMissing":          0,      // referenciadas en BBDD pero no en disco
 *       "uniqueSha":             1200,   // cuántas imágenes "reales" distintas
 *       "duplicateGroups":       380,    // grupos con >1 archivo o >1 pregunta
 *       "questionsWithImage":    8500
 *     },
 *     "groups": [
 *       {
 *         "sha256":         "abc...",
 *         "sizeBytes":      12345,
 *         "filenames":      ["320671.png"],          // todos los archivos con este SHA
 *         "questionCount":  12,
 *         "questions": [
 *           { "id": 234, "externalId": "320671", "imagen": "320671.png", "codigoTema": "TC 7.3" },
 *           ...
 *         ]
 *       },
 *       ...
 *     ],
 *     "orphanFiles":   ["foo.png", "bar.png"],
 *     "missingFiles":  ["zzz.png"]
 *   }
 *
 * Por qué este esquema "fácil de recomponer":
 *   - Cada `group` lista TODAS las preguntas que dependen del mismo binario.
 *   - Cuando sustituyamos la imagen del grupo por una nueva en pasos
 *     posteriores, basta con un UPDATE sobre las `Question.imagen` del
 *     array `questions` → sin búsquedas extra ni joins.
 *   - El SHA es la "id" natural del grupo (estable entre runs).
 *
 * Ejecutar:
 *   npm run images:audit-sha
 *
 * O directo con env vars:
 *   IMAGES_DIR=/path/to/imgs npx tsx --env-file=.env scripts/audit-images-sha.ts
 *
 * Notas:
 *   - Solo lee de disco local (default `public/images`). Si las imágenes
 *     viven solo en R2, corre primero `npm run images:copy` para poblarlas.
 *   - Solo SHA-256: dos archivos con bytes distintos por re-compresión o
 *     marca de agua salen como grupos separados. Eso lo arreglará pHash
 *     en el siguiente paso.
 */

import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { PrismaClient } from "@prisma/client"

// ── Config ──────────────────────────────────────────────────────────────
const IMAGES_DIR = process.env.IMAGES_DIR ?? resolve(process.cwd(), "public", "images")
const OUTPUT     = process.env.AUDIT_OUTPUT ?? resolve(process.cwd(), "tools", "image-audit", "sha-audit.json")

// Solo consideramos extensiones de imagen reales — ignoramos basura del SO
// (.DS_Store, Thumbs.db, etc.) y cualquier metadata que se haya colado.
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp"])

// ── Tipos ───────────────────────────────────────────────────────────────
interface QuestionRef {
  id:          number
  externalId:  string
  imagen:      string
  codigoTema:  string | null
}

interface ShaGroup {
  sha256:        string
  sizeBytes:     number
  filenames:     string[]
  questionCount: number
  questions:     QuestionRef[]
}

interface AuditOutput {
  generatedAt: string
  imagesDir:   string
  totals: {
    filesOnDisk:          number
    totalSizeBytes:       number
    filesUsedInQuestions: number
    filesOrphan:          number
    filesMissing:         number
    uniqueSha:            number
    duplicateGroups:      number
    questionsWithImage:   number
  }
  groups:       ShaGroup[]
  orphanFiles:  string[]
  missingFiles: string[]
}

const prisma = new PrismaClient()

// ── Helpers ─────────────────────────────────────────────────────────────
function sha256OfFile(filepath: string): { sha: string; size: number } {
  const data = readFileSync(filepath)
  return {
    sha:  createHash("sha256").update(data).digest("hex"),
    size: data.length,
  }
}

function isImage(filename: string): boolean {
  const dot = filename.lastIndexOf(".")
  if (dot < 0) return false
  return IMAGE_EXTENSIONS.has(filename.slice(dot).toLowerCase())
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log(`📷 Audit SHA-256 de imágenes`)
  console.log(`   Directorio:  ${IMAGES_DIR}`)
  console.log(`   Output JSON: ${OUTPUT}\n`)

  if (!existsSync(IMAGES_DIR)) {
    console.error(`❌ El directorio no existe: ${IMAGES_DIR}`)
    console.error(`   Tip: corre primero \`npm run images:copy\` o pasa IMAGES_DIR=/otra/ruta`)
    process.exit(1)
  }

  // 1) Listar archivos de imagen en disco ───────────────────────────────
  console.log(`→ Listando archivos en disco...`)
  const filesOnDisk: string[] = []
  for (const entry of readdirSync(IMAGES_DIR)) {
    const full = join(IMAGES_DIR, entry)
    if (!statSync(full).isFile()) continue
    if (!isImage(entry)) continue
    filesOnDisk.push(entry)
  }
  console.log(`  → ${filesOnDisk.length} archivos de imagen\n`)

  // 2) Sacar la BBDD: qué preguntas tienen imagen y cuál ─────────────────
  console.log(`→ Consultando BBDD (Question.imagen)...`)
  const questions = await prisma.question.findMany({
    where:  { imagen: { not: null } },
    select: { id: true, externalId: true, imagen: true, codigoTema: true },
  })
  console.log(`  → ${questions.length} preguntas con imagen\n`)

  // 3) Index: filename → [preguntas que lo usan] ─────────────────────────
  const filenameToQuestions = new Map<string, QuestionRef[]>()
  for (const q of questions) {
    if (!q.imagen) continue
    const list = filenameToQuestions.get(q.imagen) ?? []
    list.push({
      id:         q.id,
      externalId: q.externalId,
      imagen:     q.imagen,
      codigoTema: q.codigoTema,
    })
    filenameToQuestions.set(q.imagen, list)
  }

  // 4) Detectar referencias rotas (BBDD apunta a archivo que no existe) ─
  const onDiskSet = new Set(filesOnDisk)
  const missingFiles: string[] = []
  for (const filename of filenameToQuestions.keys()) {
    if (!onDiskSet.has(filename)) missingFiles.push(filename)
  }
  if (missingFiles.length > 0) {
    console.warn(`  ⚠️  ${missingFiles.length} archivos referenciados por preguntas pero NO existen en disco\n`)
  }

  // 5) SHA-256 de cada archivo ──────────────────────────────────────────
  console.log(`→ Calculando SHA-256 de ${filesOnDisk.length} archivos...`)
  const filenameToSha   = new Map<string, { sha: string; size: number }>()
  let   totalSizeBytes  = 0
  let   processed       = 0
  const startTime       = Date.now()

  for (const filename of filesOnDisk) {
    const full = join(IMAGES_DIR, filename)
    try {
      const { sha, size } = sha256OfFile(full)
      filenameToSha.set(filename, { sha, size })
      totalSizeBytes += size
    } catch (err) {
      console.warn(`\n  ⚠️  Error leyendo ${filename}: ${(err as Error).message}`)
    }
    processed++
    if (processed % 200 === 0 || processed === filesOnDisk.length) {
      process.stdout.write(`\r  ${processed}/${filesOnDisk.length}...`)
    }
  }
  const elapsedMs = Date.now() - startTime
  console.log(`\n  → hecho en ${(elapsedMs / 1000).toFixed(1)}s · ${fmtBytes(totalSizeBytes)} total\n`)

  // 6) Agrupar archivos por SHA ─────────────────────────────────────────
  const shaGroups = new Map<string, { size: number; filenames: string[] }>()
  for (const [filename, { sha, size }] of filenameToSha) {
    const g = shaGroups.get(sha) ?? { size, filenames: [] }
    g.filenames.push(filename)
    shaGroups.set(sha, g)
  }

  // 7) Construir grupos finales + clasificar huérfanos ──────────────────
  const groups: ShaGroup[] = []
  const orphanFiles: string[] = []
  let questionsWithImage   = 0
  let filesUsedInQuestions = 0

  for (const [sha, g] of shaGroups) {
    // Recolectar TODAS las preguntas que apuntan a CUALQUIER filename
    // de este grupo (puede haber varios filenames byte-idénticos: el grupo
    // une los aliases).
    const groupQuestions: QuestionRef[] = []
    const usedFilenames: string[] = []
    for (const fn of g.filenames) {
      const qs = filenameToQuestions.get(fn)
      if (qs && qs.length > 0) {
        groupQuestions.push(...qs)
        usedFilenames.push(fn)
      }
    }

    if (groupQuestions.length === 0) {
      // Nadie usa NINGÚN filename de este grupo → todos huérfanos
      orphanFiles.push(...g.filenames)
      continue
    }

    filesUsedInQuestions += usedFilenames.length
    questionsWithImage   += groupQuestions.length

    groups.push({
      sha256:        sha,
      sizeBytes:     g.size,
      filenames:     g.filenames.sort(),
      questionCount: groupQuestions.length,
      questions:     groupQuestions.sort((a, b) => a.id - b.id),
    })
  }

  // Ordenar grupos por #preguntas desc (los más reusados arriba — más
  // valor por sustituir uno bien hecho).
  groups.sort((a, b) => b.questionCount - a.questionCount)

  const duplicateGroups = groups.filter(
    (g) => g.questionCount > 1 || g.filenames.length > 1,
  ).length

  // 8) Construir output final ───────────────────────────────────────────
  const output: AuditOutput = {
    generatedAt: new Date().toISOString(),
    imagesDir:   IMAGES_DIR,
    totals: {
      filesOnDisk:          filesOnDisk.length,
      totalSizeBytes,
      filesUsedInQuestions,
      filesOrphan:          orphanFiles.length,
      filesMissing:         missingFiles.length,
      uniqueSha:            shaGroups.size,
      duplicateGroups,
      questionsWithImage,
    },
    groups,
    orphanFiles:  orphanFiles.sort(),
    missingFiles: missingFiles.sort(),
  }

  // 9) Escribir JSON ────────────────────────────────────────────────────
  const outDir = resolve(OUTPUT, "..")
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  writeFileSync(OUTPUT, JSON.stringify(output, null, 2))

  // 10) Resumen humano ──────────────────────────────────────────────────
  const dedupSavingPct = filesOnDisk.length > 0
    ? Math.round((1 - shaGroups.size / filesOnDisk.length) * 100)
    : 0

  console.log(`📊 Resumen:`)
  console.log(`   Archivos en disco:        ${output.totals.filesOnDisk.toLocaleString("es")}`)
  console.log(`   Tamaño total:             ${fmtBytes(output.totals.totalSizeBytes)}`)
  console.log(`   Archivos usados:          ${output.totals.filesUsedInQuestions.toLocaleString("es")}`)
  console.log(`   Archivos huérfanos:       ${output.totals.filesOrphan.toLocaleString("es")}`)
  console.log(`   Archivos missing (BBDD):  ${output.totals.filesMissing.toLocaleString("es")}`)
  console.log(`   SHAs únicos:              ${output.totals.uniqueSha.toLocaleString("es")}  (${dedupSavingPct}% menos)`)
  console.log(`   Grupos con duplicados:    ${output.totals.duplicateGroups.toLocaleString("es")}`)
  console.log(`   Preguntas con imagen:     ${output.totals.questionsWithImage.toLocaleString("es")}`)

  // Top 10 imágenes más reusadas — pista de cuáles atacar primero al sustituir
  console.log(`\n🔥 Top 10 imágenes más reusadas:`)
  for (const g of groups.slice(0, 10)) {
    const extra = g.filenames.length > 1 ? ` (+${g.filenames.length - 1} alias)` : ""
    console.log(`   ${String(g.questionCount).padStart(4)} preguntas  ·  ${g.filenames[0]}${extra}`)
  }

  // Distribución por nº de preguntas (histograma rápido)
  const buckets = {
    "1":     0,
    "2-5":   0,
    "6-10":  0,
    "11-20": 0,
    "21+":   0,
  }
  for (const g of groups) {
    if      (g.questionCount === 1)        buckets["1"]++
    else if (g.questionCount <= 5)         buckets["2-5"]++
    else if (g.questionCount <= 10)        buckets["6-10"]++
    else if (g.questionCount <= 20)        buckets["11-20"]++
    else                                   buckets["21+"]++
  }
  console.log(`\n📈 Distribución de reuso (cuántos grupos comparten N preguntas):`)
  for (const [bucket, count] of Object.entries(buckets)) {
    console.log(`   ${bucket.padEnd(6)} preguntas:  ${count.toLocaleString("es")} grupos`)
  }

  console.log(`\n💾 JSON escrito en: ${OUTPUT}`)
  console.log(`   Próximo paso: inspeccionar grupos top y planear pHash + clasificación.`)
}

main()
  .catch((err) => { console.error("\n❌ Error fatal:", err); process.exit(1) })
  .finally(() => prisma.$disconnect())
