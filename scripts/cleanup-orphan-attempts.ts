/**
 * Limpia attempts huérfanos: finishedAt set pero answers=[]. Estos son
 * normalmente residuo de la migración de Fase 62 (DROP TABLE questions
 * en Turso que borró las Answer en cascada) o de algún test que se
 * marcó como finalizado pero perdió las respuestas.
 *
 * Por defecto solo audita. Para borrar, pasar --apply.
 *
 *   npm run attempts:cleanup-orphan
 *   npm run attempts:cleanup-orphan -- --apply
 */
import { db } from "@/lib/db"

const APPLY = process.argv.includes("--apply")

async function main() {
  console.log(APPLY ? "🚧 MODO APPLY (se borrarán filas)" : "🔍 MODO DRY-RUN")
  console.log()

  const all = await db.examAttempt.findMany({
    include: {
      _count: { select: { answers: true } },
      user:   { select: { username: true } },
      test:   { include: { category: { select: { slug: true } } } },
    },
    orderBy: { id: "asc" },
  })

  const orphan = all.filter((a) => a.finishedAt && a._count.answers === 0)
  console.log(`📦 Total attempts: ${all.length}`)
  console.log(`🚨 Huérfanos (finishedAt set, 0 answers): ${orphan.length}`)
  console.log()

  if (orphan.length === 0) {
    console.log("✓ Nada que limpiar.")
    return
  }

  for (const a of orphan) {
    const testInfo = a.test ? `${a.test.category.slug}/${a.test.testNumber}` : "(sin test)"
    console.log(`  #${a.id}  ${a.user.username}  ${testInfo}  ${a.score}/${a.total}  ${a.startedAt.toISOString().slice(0, 16)}`)
  }
  console.log()

  if (!APPLY) {
    console.log("ℹ Para borrarlos: npm run attempts:cleanup-orphan -- --apply")
    return
  }

  const ids = orphan.map((a) => a.id)
  const result = await db.examAttempt.deleteMany({ where: { id: { in: ids } } })
  console.log(`✅ Borrados ${result.count} attempts huérfanos.`)
}

main()
  .catch((e) => { console.error("❌", e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
