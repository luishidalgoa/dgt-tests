/**
 * Script ONE-SHOT: re-asigna `testId` a los exam_attempts que quedaron
 * con `testId = NULL` tras el `turso:sync` (bug: el DELETE FROM tests
 * disparaba el onDelete:SetNull de la FK).
 *
 * Para cada attempt huérfano (mode='normal' AND testId IS NULL):
 *   1. Lee sus `answers.questionId` (las preguntas que respondió)
 *   2. Busca qué test tiene EXACTAMENTE ese set de questions (via
 *      test_questions). Si hay un único match → ese es su test.
 *   3. UPDATE exam_attempts.testId = X.
 *
 * Idempotente: si vuelves a ejecutar, los que ya recuperaron testId no
 * vuelven a procesarse (filtramos por `testId IS NULL`).
 *
 * Modo dry-run por defecto. Pasa --apply para escribir.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/fix-orphan-attempts.ts
 *   npx tsx --env-file=.env scripts/fix-orphan-attempts.ts --apply
 */
import { createClient } from "@libsql/client"

function parseArgs() {
  const argv = process.argv.slice(2)
  return { apply: argv.includes("--apply") }
}

async function main() {
  const { apply } = parseArgs()
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("✗ TURSO_DATABASE_URL no definida")
    process.exit(1)
  }
  const c = createClient({
    url:       process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })
  console.log(`📥 Target: ${process.env.TURSO_DATABASE_URL}`)
  if (!apply) console.log(`🔍 DRY-RUN — no se escribe nada. Pasa --apply para confirmar.\n`)

  // 1) Lista de attempts huérfanos a recuperar
  const orphans = await c.execute(`
    SELECT id, userId, mode, total, startedAt
      FROM exam_attempts
     WHERE testId IS NULL AND mode = 'normal' AND finishedAt IS NOT NULL
     ORDER BY id ASC
  `)
  console.log(`📋 Attempts huérfanos (mode='normal', testId NULL): ${orphans.rows.length}`)
  if (orphans.rows.length === 0) {
    console.log("✅ Nada que arreglar.")
    return
  }

  // 2) Pre-cargar mapa: test_id → set(question_id)
  const testQs = await c.execute(`SELECT testId, questionId FROM test_questions`)
  const testQuestionsMap = new Map<number, Set<number>>()
  for (const row of testQs.rows) {
    const tid = Number(row.testId)
    const qid = Number(row.questionId)
    if (!testQuestionsMap.has(tid)) testQuestionsMap.set(tid, new Set())
    testQuestionsMap.get(tid)!.add(qid)
  }
  console.log(`📚 Tests cargados con sus questions: ${testQuestionsMap.size}\n`)

  // 3) Para cada attempt, encontrar el test que matchea
  let resolved = 0
  let ambiguous = 0
  let noMatch = 0
  const updates: { attemptId: number; testId: number }[] = []

  for (const att of orphans.rows) {
    const attemptId = Number(att.id)
    const answersRes = await c.execute({
      sql:  `SELECT questionId FROM answers WHERE attemptId = ?`,
      args: [attemptId],
    })
    const questionIds = new Set<number>(
      answersRes.rows.map((r) => Number(r.questionId))
    )
    if (questionIds.size === 0) {
      console.log(`  ⚠ attempt ${attemptId}: sin answers, no se puede inferir test`)
      noMatch++
      continue
    }

    // Buscar test cuyo set de questions sea SUPERSET de las questions del attempt
    // (un attempt no siempre completa todas las questions del test, pero todas
    // sus questions deben pertenecer al test)
    const matchingTests: { testId: number; testQs: number; overlap: number }[] = []
    for (const [tid, qSet] of testQuestionsMap) {
      // Comprobamos: ¿todas las questions del attempt están en este test?
      let allIn = true
      for (const qid of questionIds) {
        if (!qSet.has(qid)) { allIn = false; break }
      }
      if (allIn) {
        matchingTests.push({ testId: tid, testQs: qSet.size, overlap: questionIds.size })
      }
    }

    if (matchingTests.length === 0) {
      console.log(`  ❌ attempt ${attemptId}: no hay test que contenga sus ${questionIds.size} questions`)
      noMatch++
    } else if (matchingTests.length === 1) {
      const m = matchingTests[0]
      console.log(`  ✅ attempt ${attemptId} → test ${m.testId}  (${m.overlap}/${m.testQs} questions)`)
      updates.push({ attemptId, testId: m.testId })
      resolved++
    } else {
      // Múltiples tests posibles — preferimos el que tenga EXACTAMENTE el
      // mismo size (más probable: el attempt completó todas las questions)
      const exact = matchingTests.find((m) => m.testQs === questionIds.size)
      if (exact) {
        console.log(`  ✅ attempt ${attemptId} → test ${exact.testId}  (match exacto ${exact.overlap}/${exact.testQs})`)
        updates.push({ attemptId, testId: exact.testId })
        resolved++
      } else {
        console.log(`  ⚠ attempt ${attemptId}: AMBIGUO — ${matchingTests.length} tests candidatos: [${matchingTests.map((m) => m.testId).join(", ")}]`)
        ambiguous++
      }
    }
  }

  console.log(`\n📊 Resumen:`)
  console.log(`   Resueltos:  ${resolved}`)
  console.log(`   Ambiguos:   ${ambiguous}`)
  console.log(`   Sin match:  ${noMatch}`)

  if (!apply) {
    console.log(`\n🔍 DRY-RUN terminado. Re-ejecuta con --apply para escribir.`)
    return
  }

  if (updates.length === 0) {
    console.log("\n⚠ Nada que actualizar.")
    return
  }

  console.log(`\n🛠  Aplicando ${updates.length} UPDATEs a exam_attempts...`)
  for (const u of updates) {
    await c.execute({
      sql:  `UPDATE exam_attempts SET testId = ? WHERE id = ?`,
      args: [u.testId, u.attemptId],
    })
  }
  console.log(`\n✅ Listo. ${updates.length} attempts ahora tienen su testId restaurado.`)
}

main().catch((e) => { console.error("❌", e); process.exit(1) })
