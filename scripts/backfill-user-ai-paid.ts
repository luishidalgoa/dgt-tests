/**
 * Backfill de user_ai_paid: para cada usuario, marca como pagada cada
 * pregunta de cada uno de sus ExamAttempts que tenga entrada en el
 * cache global aICacheEntry.
 *
 * Modelo: pago per-attempt. Por cada (user, attempt) recorre las
 * preguntas respondidas (Answer.questionId) y, si hay cache para esa
 * pregunta (con o sin imagen), inserta un row user_ai_paid asociado
 * al attempt.
 *
 * Pensado para correr UNA SOLA VEZ tras la migración de Fase 79 — así
 * cuando el usuario abre el historial, las explicaciones ya generadas
 * salen "Sin coste" sin tener que pagar otra vez.
 *
 * Por defecto dry-run.
 *
 *   npm run user-ai-paid:backfill
 *   npm run user-ai-paid:backfill -- --apply
 *   npm run user-ai-paid:backfill -- --apply --user luisph    (solo 1 user)
 */
import { db } from "@/lib/db"

const APPLY = process.argv.includes("--apply")
const userArgIdx = process.argv.indexOf("--user")
const ONLY_USER = userArgIdx >= 0 ? process.argv[userArgIdx + 1] : null

async function main() {
  console.log(APPLY ? "🚧 MODO APPLY" : "🔍 MODO DRY-RUN")
  if (ONLY_USER) console.log(`🎯 Solo para user='${ONLY_USER}'`)
  console.log()

  // 1. Cargar todas las entradas del cache para saber qué preguntas
  //    tienen explicación generada (sin/con imagen).
  const cacheRows = await db.aICacheEntry.findMany({
    select: { questionId: true, withImage: true },
  })
  const cacheSet = new Set(cacheRows.map((r) => `${r.questionId}:${r.withImage}`))
  console.log(`📦 Cache global aICacheEntry: ${cacheRows.length} entradas`)

  // 2. Cargar users
  const users = await db.user.findMany({
    where: ONLY_USER ? { username: ONLY_USER } : {},
    select: { id: true, username: true },
  })
  if (users.length === 0) {
    console.error("✗ Ningún usuario coincide.")
    process.exit(1)
  }
  console.log(`👥 Users a procesar: ${users.length}`)
  console.log()

  let totalToInsert = 0
  let totalInserted = 0
  let totalSkipped  = 0

  for (const user of users) {
    // 3. Sus attempts finalizados
    const attempts = await db.examAttempt.findMany({
      where: { userId: user.id, finishedAt: { not: null } },
      include: { answers: { select: { questionId: true, question: { select: { imagen: true } } } } },
      orderBy: { id: "asc" },
    })

    let userToInsert = 0
    let userInserted = 0
    let userSkipped  = 0

    for (const attempt of attempts) {
      for (const ans of attempt.answers) {
        const qId = ans.questionId
        const hasImage = Boolean(ans.question.imagen)
        // Probamos ambos valores de withImage que pueda haber en cache.
        const candidates: { withImage: boolean }[] = [{ withImage: false }]
        if (hasImage) candidates.push({ withImage: true })

        for (const cand of candidates) {
          const key = `${qId}:${cand.withImage}`
          if (!cacheSet.has(key)) continue

          userToInsert++

          // ¿Ya existe el row?
          const existing = await db.userAiPaid.findFirst({
            where: {
              userId:     user.id,
              questionId: qId,
              withImage:  cand.withImage,
              attemptId:  attempt.id,
            },
          })
          if (existing) {
            userSkipped++
            continue
          }

          if (APPLY) {
            await db.userAiPaid.create({
              data: {
                userId:     user.id,
                questionId: qId,
                withImage:  cand.withImage,
                attemptId:  attempt.id,
              },
            })
            userInserted++
          }
        }
      }
    }

    console.log(
      `  ${user.username.padEnd(18)} attempts=${attempts.length}  ` +
      `candidatos=${userToInsert}  ` +
      (APPLY ? `insertados=${userInserted}  ` : "") +
      `ya existían=${userSkipped}`
    )

    totalToInsert += userToInsert
    totalInserted += userInserted
    totalSkipped  += userSkipped
  }

  console.log()
  console.log("───────────────────────────────────────────────")
  console.log(`Total candidatos:   ${totalToInsert}`)
  if (APPLY) console.log(`Total insertados:   ${totalInserted}`)
  console.log(`Ya estaban en BBDD: ${totalSkipped}`)

  if (!APPLY) {
    console.log()
    console.log("ℹ Para aplicar: --apply")
  }
}

main()
  .catch((e) => { console.error("❌", e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
