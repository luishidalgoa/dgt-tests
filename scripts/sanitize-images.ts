/**
 * A partir del resultado de `audit-images-sha.ts`, copia UNA imagen
 * representante por grupo SHA-256 a `public/images/sanitize/`.
 *
 * Es el paso intermedio del pipeline de banco de imágenes propio:
 *
 *   sha-audit.json      →  sanitize-images.ts   →  public/images/sanitize/
 *   (2.6k archivos)        (este script)           (~N únicos)
 *                                                     ↓
 *                                                  TensorFlow / CLIP
 *                                                  multi-label classify
 *
 * Decisiones de diseño:
 *   - Nombre del archivo en sanitize/ = `${sha}.${ext}`. El SHA es el
 *     identificador estable del grupo en sha-audit.json — al obtener
 *     las etiquetas del clasificador será trivial recomponer (sha → tags
 *     → preguntas afectadas) leyendo sha-audit.json.
 *   - Elige `group.filenames[0]` como representante. Como el audit los
 *     ordena alfabéticamente y los grupos son byte-idénticos, da igual
 *     cuál sea — el resultado es determinista entre runs.
 *   - Ignora `orphanFiles` deliberadamente: son imágenes sin Question
 *     que las referencie → no hace falta clasificarlas. Si quieres
 *     incluirlas en una pasada futura, fácil de añadir vía flag.
 *
 * Idempotente: si `${sha}.${ext}` ya existe en destino, lo salta.
 * Forzar redo total: `CLEAN=1 npm run images:sanitize`.
 *
 * Uso:
 *   npm run images:sanitize
 *
 * Input:  tools/image-audit/sha-audit.json
 *         public/images/*.{png,jpg,...}
 * Output: public/images/sanitize/{sha}.{ext}
 */
import {
  readFileSync,
  copyFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  unlinkSync,
  statSync,
} from "node:fs"
import { join, extname, resolve } from "node:path"

const AUDIT_PATH  = resolve(process.cwd(), "tools", "image-audit", "sha-audit.json")
const SOURCE_DIR  = resolve(process.cwd(), "public", "images")
const TARGET_DIR  = resolve(process.cwd(), "public", "images", "sanitize")
const CLEAN_FIRST = process.env.CLEAN === "1"

// Tipado mínimo del audit — solo lo que necesitamos. Si cambia el formato
// del JSON, esto va a romper explícito (mejor que silencio).
interface ShaGroup {
  sha256:        string
  sizeBytes:     number
  filenames:     string[]
  questionCount: number
}

interface AuditOutput {
  generatedAt: string
  groups:      ShaGroup[]
  totals:      Record<string, number>
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

async function main() {
  console.log(`🧼 Sanitize: copiando 1 imagen por SHA a sanitize/`)
  console.log(`   Audit:   ${AUDIT_PATH}`)
  console.log(`   Source:  ${SOURCE_DIR}`)
  console.log(`   Target:  ${TARGET_DIR}\n`)

  // 1) Leer audit ──────────────────────────────────────────────────────
  if (!existsSync(AUDIT_PATH)) {
    console.error(`❌ No existe ${AUDIT_PATH}`)
    console.error(`   Corre primero: npm run images:audit-sha`)
    process.exit(1)
  }

  const audit: AuditOutput = JSON.parse(readFileSync(AUDIT_PATH, "utf-8"))
  console.log(`📊 Audit: ${audit.groups.length} grupos únicos · generado ${audit.generatedAt}`)

  if (audit.groups.length === 0) {
    console.log("⚠  No hay grupos para sanitizar. Salgo.")
    process.exit(0)
  }

  // 2) Preparar carpeta destino ───────────────────────────────────────
  if (!existsSync(TARGET_DIR)) {
    mkdirSync(TARGET_DIR, { recursive: true })
  } else if (CLEAN_FIRST) {
    console.log(`⚠  CLEAN=1 → vaciando ${TARGET_DIR}`)
    let deleted = 0
    for (const entry of readdirSync(TARGET_DIR)) {
      const full = join(TARGET_DIR, entry)
      if (statSync(full).isFile()) {
        unlinkSync(full)
        deleted++
      }
    }
    console.log(`   ${deleted} archivos borrados\n`)
  }

  // 3) Copiar representante de cada grupo ──────────────────────────────
  let copied      = 0
  let skipped     = 0
  let missing     = 0
  let failed      = 0
  let totalBytes  = 0

  console.log(`⬇  Copiando representantes (${audit.groups.length} archivos)...\n`)

  for (const group of audit.groups) {
    // Elegir el primer filename del grupo. Como el audit los ordenó
    // alfabéticamente, esta elección es determinista.
    const sourceFilename = group.filenames[0]
    if (!sourceFilename) {
      console.warn(`  ⚠  Grupo ${group.sha256.slice(0, 8)}... sin filenames (skip)`)
      failed++
      continue
    }

    const sourcePath = join(SOURCE_DIR, sourceFilename)
    if (!existsSync(sourcePath)) {
      console.warn(`  ⚠  ${sourceFilename} no existe en disco (skip)`)
      missing++
      continue
    }

    // Nombre destino = SHA completo + ext del original.
    // SHA = 64 hex chars; los filesystems modernos aguantan 255+ bytes sin
    // drama. Usar el SHA completo elimina riesgo de colisión y permite
    // verificación visual de que el archivo proviene del grupo correcto.
    const ext            = extname(sourceFilename).toLowerCase()
    const targetFilename = `${group.sha256}${ext}`
    const targetPath     = join(TARGET_DIR, targetFilename)

    if (existsSync(targetPath)) {
      skipped++
      continue
    }

    try {
      copyFileSync(sourcePath, targetPath)
      copied++
      totalBytes += group.sizeBytes
    } catch (err) {
      console.error(`  ❌ ${sourceFilename} → ${targetFilename}: ${err instanceof Error ? err.message : err}`)
      failed++
    }
  }

  // 4) Resumen ─────────────────────────────────────────────────────────
  console.log(`\n✅ Sanitización completada`)
  console.log(`   Copiados:        ${copied.toLocaleString("es")}`)
  console.log(`   Ya existían:     ${skipped.toLocaleString("es")}`)
  console.log(`   Source missing:  ${missing.toLocaleString("es")}`)
  console.log(`   Fallidos:        ${failed.toLocaleString("es")}`)
  console.log(`   Tamaño copiado:  ${fmtBytes(totalBytes)}`)
  console.log(`   Total grupos:    ${audit.groups.length.toLocaleString("es")}`)

  if (failed > 0 || missing > 0) {
    console.log(`\n⚠  Hubo ${failed + missing} grupos sin copiar — revisa los warnings arriba.`)
  }

  console.log(`\n📌 Próximo paso: clasificación multi-label con TensorFlow/CLIP`)
  console.log(`   Input para el clasificador: ${TARGET_DIR}`)
  console.log(`   Cada archivo se llama {sha}.{ext} → identifier estable que liga`)
  console.log(`   los tags resultantes con sha-audit.json (y de ahí a las preguntas).`)
}

main().catch((err) => {
  console.error("\n💥 Error fatal:", err)
  process.exit(1)
})
