/** Inspecciona la variedad de códigos de tema para diseñar el agrupamiento */
import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()

interface Row {
  prefix: string
  count: bigint
}

async function main() {
  const result = await db.$queryRaw<Row[]>`
    SELECT
      CASE
        WHEN INSTR(codigoTema, '-') > 0
        THEN SUBSTR(codigoTema, 1, INSTR(codigoTema, '-') - 1)
        ELSE codigoTema
      END as prefix,
      COUNT(*) as count
    FROM questions
    WHERE codigoTema IS NOT NULL
    GROUP BY prefix
    ORDER BY count DESC
    LIMIT 20
  `
  console.log("\nTop 20 prefijos de tema:")
  for (const r of result) {
    console.log(`  ${r.prefix.padEnd(15)} → ${Number(r.count)} preguntas`)
  }

  // Cuántos prefijos distintos hay
  const totalDistinct = await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(DISTINCT
      CASE
        WHEN INSTR(codigoTema, '-') > 0
        THEN SUBSTR(codigoTema, 1, INSTR(codigoTema, '-') - 1)
        ELSE codigoTema
      END
    ) as count
    FROM questions
    WHERE codigoTema IS NOT NULL
  `
  console.log(`\nTotal prefijos distintos: ${Number(totalDistinct[0].count)}`)

  // Ejemplos de codigoTema completos
  const samples = await db.question.findMany({
    select: { codigoTema: true },
    where: { codigoTema: { not: null } },
    distinct: ["codigoTema"],
    take: 10,
  })
  console.log("\nEjemplos de codigoTema completo:")
  for (const s of samples) console.log(`  ${s.codigoTema}`)
}

main().finally(() => db.$disconnect())
