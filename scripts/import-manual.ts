/**
 * Importa los datos del manual del temario desde AEOL-COCHE/manual_temario/
 *
 *  - Lee indice.json
 *  - Crea ManualSection en la BBDD por cada subtema
 *  - Copia cada PDF a /public/manual/pdfs/<filename>
 *
 * Las imágenes JPG NO se importan: el visor usa PDF.js para renderizar el
 * PDF como HTML/canvas en cliente.
 *
 * Ejecutar:  npm run manual:import
 */

import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import { readFileSync, existsSync, mkdirSync, copyFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const databaseUrl =
  process.env.TURSO_DATABASE_URL ??
  pathToFileURL(resolve(process.cwd(), "prisma", "dev.db")).href

const adapter = new PrismaLibSql({
  url: databaseUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

const db = new PrismaClient({ adapter })

const SOURCE_PATH = process.env.AEOL_PATH ?? "C:/Users/luish/Downloads/AEOL-COCHE"
const SOURCE_DIR  = join(SOURCE_PATH, "manual_temario")
const PDF_SRC     = join(SOURCE_DIR, "pdfs")
const TARGET_DIR  = join(process.cwd(), "public", "manual", "pdfs")

interface IndicePage {
  index:          number
  page_in_book:   number | null
  topic_detected: string | null
  filename:       string
}

interface IndiceSubtema {
  code:             string
  name:             string
  first_test_id:    number
  pdf:              string | null
  captured_pages:   number
  book_total_pages: number | null
  page_range:       { first: number; last: number } | null
  pages:            IndicePage[]
  extracted_at:     string
}

interface IndiceTema {
  code:     string
  name:     string
  subtemas: IndiceSubtema[]
}

interface IndiceData {
  generated_at: string
  source:       string
  temas:        Record<string, IndiceTema>
}

function slugifyFolder(code: string): string {
  return "tema_" + code.replace(/\./g, "_").replace(/[^A-Za-z0-9_]/g, "_")
}

function copyPdf(pdfName: string | null): boolean {
  if (!pdfName) return false
  const sf = join(PDF_SRC, pdfName)
  if (!existsSync(sf) || !statSync(sf).isFile()) return false
  const df = join(TARGET_DIR, pdfName)
  if (existsSync(df)) return true   // ya copiado
  copyFileSync(sf, df)
  return true
}

async function main() {
  const indicePath = join(SOURCE_DIR, "indice.json")
  if (!existsSync(indicePath)) {
    console.error(`✗ No existe: ${indicePath}`)
    process.exit(1)
  }
  if (!existsSync(TARGET_DIR)) mkdirSync(TARGET_DIR, { recursive: true })

  const indice: IndiceData = JSON.parse(readFileSync(indicePath, "utf-8"))

  console.log("📚 Importando manual del temario")
  console.log(`   Origen: ${SOURCE_DIR}`)
  console.log(`   Destino PDFs: ${TARGET_DIR}\n`)

  let totalSections = 0
  let totalPdfs    = 0
  let totalSkipped = 0
  const missingPdfs: string[] = []

  for (const tema of Object.values(indice.temas)) {
    for (const sub of tema.subtemas) {
      if (!sub.pages || sub.pages.length === 0) {
        totalSkipped++
        continue
      }

      const folder    = slugifyFolder(sub.code)
      const pdfCopied = copyPdf(sub.pdf)

      if (sub.pdf && !pdfCopied) {
        missingPdfs.push(sub.pdf)
      }
      if (pdfCopied) totalPdfs++

      await db.manualSection.upsert({
        where: { subtemaCode: sub.code },
        update: {
          temaCode:    tema.code,
          temaName:    tema.name,
          subtemaName: sub.name,
          folder,
          pages:       JSON.stringify(sub.pages),
          totalPages:  sub.pages.length,
          pdfFilename: sub.pdf ?? null,
        },
        create: {
          temaCode:    tema.code,
          temaName:    tema.name,
          subtemaCode: sub.code,
          subtemaName: sub.name,
          folder,
          pages:       JSON.stringify(sub.pages),
          totalPages:  sub.pages.length,
          pdfFilename: sub.pdf ?? null,
        },
      })

      totalSections++
      const flag = pdfCopied ? "✓" : "—"
      console.log(`   ${flag} ${sub.code.padEnd(6)} ${sub.name.slice(0, 48).padEnd(48)} ${sub.pages.length} págs  ${pdfCopied ? `PDF ${sub.pdf}` : "(sin PDF)"}`)
    }
  }

  console.log(`\n✅ Importación completada`)
  console.log(`   Secciones registradas : ${totalSections}`)
  console.log(`   PDFs copiados         : ${totalPdfs}`)
  console.log(`   Subtemas omitidos     : ${totalSkipped}  (sin páginas)`)
  if (missingPdfs.length > 0) {
    console.log(`\n   ⚠️  PDFs declarados en indice.json pero no encontrados en ${PDF_SRC}:`)
    for (const p of missingPdfs) console.log(`      - ${p}`)
  }
}

main()
  .catch((e) => {
    console.error("❌ Error:", e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
