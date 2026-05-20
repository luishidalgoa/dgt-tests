/**
 * Copia todas las imágenes de los bancos AEOL-COCHE a public/images/
 * Las imágenes están nombradas por id_pregunta (ej. 320671.png), así que
 * un único directorio plano basta para todos los bancos.
 *
 * Ejecutar:  npm run images:copy
 */

import { readdirSync, existsSync, mkdirSync, copyFileSync, statSync } from "node:fs"
import { join } from "node:path"

const AEOL_PATH   = process.env.AEOL_PATH ?? process.cwd()
const TARGET_PATH = join(process.cwd(), "public", "images")

const BANKS = ["banco_134", "banco_434", "banco_501"]

function copyBank(folder: string): { copied: number; skipped: number } {
  const src = join(AEOL_PATH, folder, "imagenes")
  if (!existsSync(src)) {
    console.log(`   ⚠️  ${folder}/imagenes no existe`)
    return { copied: 0, skipped: 0 }
  }

  let copied = 0
  let skipped = 0

  for (const file of readdirSync(src)) {
    const srcFile = join(src, file)
    const dstFile = join(TARGET_PATH, file)

    if (!statSync(srcFile).isFile()) continue

    if (existsSync(dstFile)) {
      skipped++
      continue
    }

    copyFileSync(srcFile, dstFile)
    copied++
  }

  return { copied, skipped }
}

function main() {
  console.log("📷 Copiando imágenes a public/images/")
  console.log(`   Origen:  ${AEOL_PATH}`)
  console.log(`   Destino: ${TARGET_PATH}\n`)

  if (!existsSync(TARGET_PATH)) {
    mkdirSync(TARGET_PATH, { recursive: true })
  }

  let totalCopied = 0
  let totalSkipped = 0

  for (const bank of BANKS) {
    const { copied, skipped } = copyBank(bank)
    console.log(`   ${bank}  →  copiadas ${copied}, ya existían ${skipped}`)
    totalCopied += copied
    totalSkipped += skipped
  }

  console.log(`\n✅ Total: ${totalCopied} copiadas, ${totalSkipped} ya existentes`)
}

main()
