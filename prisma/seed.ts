/**
 * Seed de la base de datos DGT Tests.
 * Lee los JSONs de C:/Users/luish/Downloads/AEOL-COCHE/banco_* y rellena la DB.
 *
 * Ejecutar:  npm run db:seed
 */

import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import { readdirSync, readFileSync, existsSync } from "node:fs"
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

// ── Configuración ─────────────────────────────────────────────────────────
// Por defecto busca las carpetas banco_* en la raíz del proyecto.
// Puedes sobrescribir con AEOL_PATH=ruta/a/carpetas si quieres usar otra ruta.
const AEOL_PATH = process.env.AEOL_PATH ?? process.cwd()

interface BankConfig {
  code: string
  slug: string
  name: string
  description: string
  folder: string
}

const BANKS: BankConfig[] = [
  {
    code: "134",
    slug: "permiso-b",
    name: "Examen permiso B",
    description: "Examen tipo del carné B con 88 tests de 30 preguntas cada uno.",
    folder: "banco_134",
  },
  {
    code: "434",
    slug: "repaso-final",
    name: "Repaso final",
    description: "Tests de repaso final antes de presentarse al examen.",
    folder: "banco_434",
  },
  {
    code: "501",
    slug: "adas",
    name: "Test ADAS",
    description: "Test sobre sistemas avanzados de asistencia a la conducción.",
    folder: "banco_501",
  },
]

// ── Tipos para los JSONs ──────────────────────────────────────────────────
interface JsonOption {
  letra: string
  texto: string
}

interface JsonQuestion {
  numero: number
  codigo_tema?: string
  pregunta: string
  opciones: JsonOption[]
  respuesta_correcta: string
  explicacion: string
  imagen?: string | null
  id_pregunta: string
}

interface JsonTest {
  test_number: number
  exam_series: number
  total_preguntas: number
  preguntas: JsonQuestion[]
}

// ── Helpers ───────────────────────────────────────────────────────────────
const LETTER_MAP: Record<string, string> = {
  "1": "A", "2": "B", "3": "C", "4": "D",
  A: "A",   B: "B",   C: "C",   D: "D",
}

function normalizeLetter(raw: string): string {
  return LETTER_MAP[raw] ?? raw.toUpperCase()
}

function textsMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")
  return norm(a) === norm(b)
}

// ── Lógica principal ──────────────────────────────────────────────────────
async function seedBank(bank: BankConfig) {
  console.log(`\n━━━ Procesando ${bank.code} — ${bank.name} ━━━`)

  const bankPath = join(AEOL_PATH, bank.folder)
  if (!existsSync(bankPath)) {
    console.log(`   ⚠️  Carpeta no encontrada: ${bankPath}`)
    return
  }

  // Crear/actualizar categoría
  const category = await db.category.upsert({
    where: { code: bank.code },
    update: { name: bank.name, slug: bank.slug, description: bank.description },
    create: {
      code: bank.code,
      slug: bank.slug,
      name: bank.name,
      description: bank.description,
    },
  })
  console.log(`   ✓ Categoría #${category.id} — ${category.name}`)

  // Listar archivos test_*.json
  const files = readdirSync(bankPath)
    .filter((f) => /^test_\d+\.json$/.test(f))
    .sort()

  let totalQuestions = 0
  let totalSkipped = 0

  for (const file of files) {
    const json = JSON.parse(readFileSync(join(bankPath, file), "utf-8")) as JsonTest

    // Crear o actualizar el test
    const test = await db.test.upsert({
      where: {
        categoryId_testNumber: {
          categoryId: category.id,
          testNumber: json.test_number,
        },
      },
      update: { totalQuestions: json.total_preguntas },
      create: {
        categoryId: category.id,
        testNumber: json.test_number,
        totalQuestions: json.total_preguntas,
      },
    })

    // Procesar preguntas
    for (const q of json.preguntas) {
      // Saltar preguntas sin opciones (corruptas)
      if (!q.opciones || q.opciones.length === 0) {
        totalSkipped++
        continue
      }

      const question = await db.question.upsert({
        where: { externalId: q.id_pregunta },
        update: {
          codigoTema: q.codigo_tema ?? null,
          enunciado: q.pregunta,
          explicacion: q.explicacion,
          imagen: q.imagen ?? null,
        },
        create: {
          externalId: q.id_pregunta,
          codigoTema: q.codigo_tema ?? null,
          enunciado: q.pregunta,
          explicacion: q.explicacion,
          imagen: q.imagen ?? null,
        },
      })

      // Asociar pregunta al test (con su orden)
      await db.testQuestion.upsert({
        where: {
          testId_questionId: { testId: test.id, questionId: question.id },
        },
        update: { order: q.numero },
        create: { testId: test.id, questionId: question.id, order: q.numero },
      })

      // Borrar opciones antiguas y recrearlas (la pregunta ya pudo existir
      // de un test previo, las opciones son las mismas pero las recreamos
      // por si el texto cambió)
      await db.option.deleteMany({ where: { questionId: question.id } })

      for (const opt of q.opciones) {
        const letra = normalizeLetter(opt.letra)
        await db.option.create({
          data: {
            questionId: question.id,
            letra,
            texto: opt.texto,
            isCorrect: textsMatch(opt.texto, q.respuesta_correcta),
          },
        })
      }

      totalQuestions++
    }

    console.log(`   ✓ Test ${json.test_number.toString().padStart(3, " ")}  →  ${json.preguntas.length} preguntas`)
  }

  console.log(`   📊 Total: ${totalQuestions} preguntas guardadas (${totalSkipped} omitidas)`)
}

async function main() {
  console.log("🌱 Iniciando seed DGT Tests")
  console.log(`   Fuente: ${AEOL_PATH}`)

  for (const bank of BANKS) {
    await seedBank(bank)
  }

  // Resumen final
  const stats = await Promise.all([
    db.category.count(),
    db.test.count(),
    db.question.count(),
    db.option.count(),
  ])
  console.log(`\n━━━ RESUMEN ━━━`)
  console.log(`   Categorías : ${stats[0]}`)
  console.log(`   Tests      : ${stats[1]}`)
  console.log(`   Preguntas  : ${stats[2]}`)
  console.log(`   Opciones   : ${stats[3]}`)
  console.log("✅ Seed completado\n")
}

main()
  .catch((e) => {
    console.error("❌ Error en seed:", e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
