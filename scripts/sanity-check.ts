/**
 * Verificación rápida del estado de la BBDD tras el seed.
 */

import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const databaseUrl =
  process.env.TURSO_DATABASE_URL ??
  pathToFileURL(resolve(process.cwd(), "prisma", "dev.db")).href

const adapter = new PrismaLibSql({
  url: databaseUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

const db = new PrismaClient({ adapter })

async function main() {
  // Conteo por categoría
  const categories = await db.category.findMany({
    include: {
      _count: { select: { tests: true } },
    },
  })

  console.log("\n━━━ POR CATEGORÍA ━━━")
  for (const c of categories) {
    const tests = await db.test.findMany({
      where: { categoryId: c.id },
      include: { _count: { select: { testQuestions: true } } },
    })
    const totalQs = tests.reduce((s, t) => s + t._count.testQuestions, 0)
    console.log(`  [${c.code}] ${c.name}: ${c._count.tests} tests, ${totalQs} asociaciones pregunta-test`)
  }
  const totalUnique = await db.question.count()
  console.log(`\n  Preguntas únicas globales: ${totalUnique}`)

  // Preguntas sin respuesta correcta identificada (problema potencial)
  const qsSinCorrecta = await db.question.count({
    where: { options: { none: { isCorrect: true } } },
  })
  console.log(`\n━━━ INTEGRIDAD ━━━`)
  console.log(`  Preguntas sin respuesta correcta identificada: ${qsSinCorrecta}`)

  // Mostrar 3 ejemplos sin respuesta correcta
  if (qsSinCorrecta > 0) {
    const ejemplos = await db.question.findMany({
      where: { options: { none: { isCorrect: true } } },
      include: { options: true },
      take: 3,
    })
    console.log("\n  Ejemplos:")
    for (const q of ejemplos) {
      console.log(`    [${q.externalId}] ${q.enunciado.slice(0, 70)}...`)
      console.log(`      Opciones: ${q.options.map((o) => `${o.letra}=${o.texto.slice(0, 30)}`).join(" | ")}`)
    }
  }

  // Preguntas sin imagen
  const qsSinImagen = await db.question.count({ where: { imagen: null } })
  console.log(`  Preguntas sin imagen: ${qsSinImagen}`)
}

main().finally(() => db.$disconnect())
