/**
 * Marca como tier=FREE las preguntas que pertenecen a los primeros N tests
 * de la categoría free (permiso-b). El resto queda como tier=PRO (default).
 *
 * Idempotente: se puede correr varias veces, siempre deja el mismo estado.
 *
 *   npx tsx --env-file=.env scripts/tag-question-tiers.ts
 */
import { db } from "@/lib/db"
import { FREE_CATEGORY_SLUG, FREE_TEST_LIMIT } from "@/lib/permissions"

async function main() {
  console.log(`📦 Categoría free: ${FREE_CATEGORY_SLUG}`)
  console.log(`🆓 Tests free: 1..${FREE_TEST_LIMIT}`)
  console.log()

  const cat = await db.category.findUnique({
    where: { slug: FREE_CATEGORY_SLUG },
    include: {
      tests: {
        where: { testNumber: { gte: 1, lte: FREE_TEST_LIMIT } },
        include: { testQuestions: { select: { questionId: true } } },
      },
    },
  })
  if (!cat) {
    console.error(`✗ No existe la categoría '${FREE_CATEGORY_SLUG}'`)
    process.exit(1)
  }

  // 1. Recolectar todos los question ids de los tests free
  const freeQuestionIds = new Set<number>()
  for (const t of cat.tests) {
    for (const tq of t.testQuestions) {
      freeQuestionIds.add(tq.questionId)
    }
  }
  const ids = Array.from(freeQuestionIds)
  console.log(`→ ${cat.tests.length} tests free encontrados, ${ids.length} preguntas únicas`)

  if (ids.length === 0) {
    console.warn("⚠ No se encontraron preguntas — ¿están los tests indexados?")
    process.exit(0)
  }

  // 2. Resetear TODAS las preguntas a PRO (asegura idempotencia: si en el futuro
  //    se redefinen los free tests, las que dejen de serlo vuelven a PRO).
  const resetCount = await db.question.updateMany({
    where: { tier: "FREE" },
    data:  { tier: "PRO" },
  })
  if (resetCount.count > 0) {
    console.log(`→ Reseteadas ${resetCount.count} preguntas FREE previas a PRO`)
  }

  // 3. Marcar como FREE las que sí lo son
  const updated = await db.question.updateMany({
    where: { id: { in: ids } },
    data:  { tier: "FREE" },
  })
  console.log(`✓ ${updated.count} preguntas marcadas como FREE`)

  // 4. Resumen final
  const total = await db.question.count()
  const free  = await db.question.count({ where: { tier: "FREE" } })
  const pro   = await db.question.count({ where: { tier: "PRO" } })
  console.log()
  console.log(`📊 Resumen: ${total} preguntas totales`)
  console.log(`   - FREE: ${free}`)
  console.log(`   - PRO : ${pro}`)
}

main()
  .catch((e) => {
    console.error("❌", e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
