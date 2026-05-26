/**
 * Sincroniza el SQLite local (prisma/dev.db) → Turso (producción).
 *
 * COMPORTAMIENTO POR DEFECTO (seguro para prod):
 *
 *   ✅ Sincroniza: categories, tests, test_questions, manual_sections,
 *      options, questions (con protección admin), ai_cache_entries
 *      (insert-only).
 *
 *   🛡 PRESERVA en prod (NO se sobrescriben):
 *      - Datos de usuario:    users, exam_attempts, answers
 *      - Datos de competición: parties, party_players, party_answers
 *      - Análisis IA usuario:  user_ai_stats_analysis, user_ai_paid
 *      - Reportes:            question_reports
 *      - Secrets / config:    app_config
 *      - Questions con lastEditedAt o aiApproved (revisadas / editadas
 *        por admin en prod) — se respeta su versión prod.
 *
 *   ➕ INSERT-ONLY (no pisa existentes):
 *      - ai_cache_entries — los cachés generados en prod NO se borran.
 *
 *   🔑 Matching por clave natural (externalId, code, subtemaCode…), no
 *      por id auto-increment — así local/prod pueden tener IDs distintas
 *      sin conflicto.
 *
 * USO:
 *   npm run turso:sync                # sync seguro (default)
 *   npm run turso:sync -- --dry-run   # preview sin escribir
 *
 * FLAGS PELIGROSOS (no uses sin estar muy seguro):
 *   --include-user-data       Sobrescribe users + historial usuario
 *   --include-app-config      Sobrescribe secrets de prod
 *   --no-admin-protection     Sobrescribe questions editadas/aprobadas por admin
 *
 * FLAGS de seleccion (skip parcial):
 *   --no-system-data          Skip categories/tests/test_questions/manual_sections
 *   --no-questions            Skip questions + options
 *   --no-ai-cache             Skip ai_cache_entries
 */

import { createClient, type Client, type InStatement } from "@libsql/client"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

// ── Config ──────────────────────────────────────────────────────────────

interface SyncConfig {
  // Qué sincronizar
  syncSystemData:     boolean   // categories, tests, test_questions, manual_sections
  syncQuestions:      boolean   // questions + options (con protección admin)
  syncAICache:        boolean   // ai_cache_entries (insert-only)
  syncUserData:       boolean   // ⚠ users, exam_attempts, answers (DANGEROUS)
  syncAppConfig:      boolean   // ⚠ app_config (DANGEROUS — pisas secrets)
  respectAdminWork:   boolean   // skip questions con lastEditedAt o aiApproved
  dryRun:             boolean
}

const DEFAULT_CONFIG: SyncConfig = {
  syncSystemData:    true,
  syncQuestions:     true,
  syncAICache:       true,
  syncUserData:      false,  // por defecto NO se tocan datos de usuario
  syncAppConfig:     false,  // por defecto NO se pisan secrets
  respectAdminWork:  true,   // por defecto SE respeta el trabajo admin
  dryRun:            false,
}

function parseArgs(): SyncConfig {
  const argv  = process.argv.slice(2)
  const cfg   = { ...DEFAULT_CONFIG }
  if (argv.includes("--dry-run") || argv.includes("-n")) cfg.dryRun = true
  if (argv.includes("--no-system-data"))      cfg.syncSystemData = false
  if (argv.includes("--no-questions"))        cfg.syncQuestions  = false
  if (argv.includes("--no-ai-cache"))         cfg.syncAICache    = false
  if (argv.includes("--include-user-data"))   cfg.syncUserData   = true
  if (argv.includes("--include-app-config"))  cfg.syncAppConfig  = true
  if (argv.includes("--no-admin-protection")) cfg.respectAdminWork = false
  return cfg
}

// ── Tipos ───────────────────────────────────────────────────────────────

interface LocalQuestion {
  id:           number
  externalId:   string
  codigoTema:   string | null
  enunciado:    string
  explicacion:  string
  imagen:       string | null
  tier:         string
  aiGenerated:  number
  aiModel:      string | null
  aiReviewedAt: string | null
  aiApproved:   number | null
}

interface LocalOption {
  id:         number
  questionId: number
  letra:      string
  texto:      string
  isCorrect:  number
}

// Campos que se UPDATEAN para una question existente en prod (no protegida).
// EXCLUYE deliberadamente aiApproved, aiReviewedAt, lastEditedAt, lastEditedBy:
// esos son trabajo del admin y nunca se pisan local→prod.
const QUESTION_UPDATE_FIELDS = [
  "codigoTema",
  "enunciado",
  "explicacion",
  "imagen",
  "tier",
  "aiGenerated",
  "aiModel",
] as const

// Campos al INSERTAR una question nueva en prod (no incluye id —
// dejamos que Turso lo auto-genere).
const QUESTION_INSERT_FIELDS = [
  "externalId",
  ...QUESTION_UPDATE_FIELDS,
  "aiApproved",     // si es una pregunta nueva sin review, va con su estado actual
  "aiReviewedAt",
] as const

// ── Logging ─────────────────────────────────────────────────────────────

function header(text: string) {
  console.log(`\n━━━ ${text} ━━━`)
}

// ── Bloques de sync ─────────────────────────────────────────────────────

/**
 * Tablas sistema-data (categorías, tests, manual_sections, test_questions).
 * Sin trabajo admin → DELETE + INSERT preservando IDs locales es seguro.
 *
 * NOTA: test_questions.questionId depende de question.id. Si questions
 * se sincroniza por externalId (sin preservar IDs), tras questions sync
 * habrá que recalcular las references de test_questions. Por eso este
 * bloque hace test_questions DESPUÉS de questions, usando un map local→prod
 * de question IDs.
 */
async function syncSystemData(
  src: Client,
  tgt: Client,
  cfg: SyncConfig,
  questionIdMap: Map<number, number>,
) {
  if (!cfg.syncSystemData) {
    console.log("⏭  syncSystemData: skipped (--no-system-data)")
    return
  }

  header("Sistema: categories, tests, manual_sections")

  // ANTES de hacer DELETE FROM tests, guardamos en memoria el mapeo
  // (attemptId → testId) que tiene PROD. El DELETE dispara el
  // onDelete:SetNull de ExamAttempt.testId (schema línea 237) y dejaría
  // huérfanos todos los exam_attempts en prod. Tras el INSERT que
  // recrea los tests con sus IDs originales (que NO cambian porque
  // preservamos IDs locales), restauramos los testId.
  let attemptTestIdSnapshot: { id: number; testId: number }[] = []
  if (!cfg.dryRun) {
    const snap = await tgt.execute(
      `SELECT id, testId FROM exam_attempts WHERE testId IS NOT NULL`,
    )
    attemptTestIdSnapshot = snap.rows.map((r) => ({
      id:     Number(r.id),
      testId: Number(r.testId),
    }))
    console.log(`  📸 snapshot exam_attempts.testId: ${attemptTestIdSnapshot.length} filas (para restaurar tras delete)`)
  }

  // categories, tests, manual_sections: DELETE+INSERT (preservando IDs)
  for (const table of ["categories", "tests", "manual_sections"] as const) {
    const { rows, columns } = await src.execute(`SELECT * FROM ${table}`)
    console.log(`  ${table.padEnd(20)} → ${rows.length} filas`)
    if (cfg.dryRun) continue
    await tgt.execute(`DELETE FROM ${table}`)
    if (rows.length === 0) continue
    const placeholders = "(" + columns.map(() => "?").join(",") + ")"
    const insertSql = `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(",")}) VALUES ${placeholders}`
    const batchSize = 50
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      await tgt.batch(
        batch.map((row) => ({ sql: insertSql, args: columns.map((c) => row[c]) })),
        "write",
      )
    }
  }

  // Restaurar testId de attempts huérfanos (los que tenían testId apuntando
  // a tests que existían antes del DELETE). Solo restauramos si el testId
  // sigue existiendo en la tabla tests recién re-insertada (matching por id).
  if (!cfg.dryRun && attemptTestIdSnapshot.length > 0) {
    const validIds = await tgt.execute(`SELECT id FROM tests`)
    const validSet = new Set(validIds.rows.map((r) => Number(r.id)))
    const toRestore = attemptTestIdSnapshot.filter((s) => validSet.has(s.testId))
    let restored = 0
    for (let i = 0; i < toRestore.length; i += 100) {
      const chunk = toRestore.slice(i, i + 100)
      await tgt.batch(
        chunk.map((s) => ({
          sql:  `UPDATE exam_attempts SET testId = ? WHERE id = ?`,
          args: [s.testId, s.id],
        })),
        "write",
      )
      restored += chunk.length
    }
    console.log(`  🔁 testId restaurado en ${restored}/${attemptTestIdSnapshot.length} attempts`)
  }

  // test_questions: depende de questions ya estar sincronizadas.
  // Re-mapea questionId local → prod usando questionIdMap.
  header("Sistema: test_questions (re-mapeo por questionId prod)")
  const tqRes = await src.execute(`SELECT * FROM test_questions`)
  console.log(`  test_questions      → ${tqRes.rows.length} filas (local)`)
  if (!cfg.dryRun) {
    await tgt.execute(`DELETE FROM test_questions`)
    const cols = tqRes.columns
    const placeholders = "(" + cols.map(() => "?").join(",") + ")"
    const insertSql = `INSERT INTO test_questions (${cols.map((c) => `"${c}"`).join(",")}) VALUES ${placeholders}`
    const batch: InStatement[] = []
    let skipped = 0
    for (const row of tqRes.rows) {
      const localQId = Number(row.questionId)
      const prodQId  = questionIdMap.get(localQId)
      if (!prodQId) { skipped++; continue }
      const args = cols.map((c) => c === "questionId" ? prodQId : row[c])
      batch.push({ sql: insertSql, args })
    }
    // Batches grandes — cada llamada Turso soporta cientos de stmts en un batch
    const chunkSize = 500
    for (let i = 0; i < batch.length; i += chunkSize) {
      await tgt.batch(batch.slice(i, i + chunkSize), "write")
      process.stdout.write(`\r     insertadas ${Math.min(i + chunkSize, batch.length)}/${batch.length}`)
    }
    if (batch.length > 0) process.stdout.write(`\n`)
    console.log(`     total: ${batch.length}  ${skipped > 0 ? `skipped (question no en prod): ${skipped}` : ""}`)
  }
}

/**
 * Questions + options. Para cada local question:
 *   - Si prod la tiene Y es admin-protegida → SKIP (preserva prod).
 *   - Si prod la tiene y no protegida       → UPDATE campos de contenido.
 *   - Si prod no la tiene                   → INSERT.
 *
 * Devuelve un map localQuestionId → prodQuestionId para que test_questions
 * y ai_cache_entries puedan re-mapear sus FKs.
 *
 * Para options: tras procesar una question, DELETE+INSERT sus options
 * (excepto para questions skipped, donde se preservan prod).
 */
async function syncQuestions(
  src: Client,
  tgt: Client,
  cfg: SyncConfig,
): Promise<Map<number, number>> {
  const idMap = new Map<number, number>()

  if (!cfg.syncQuestions) {
    console.log("⏭  syncQuestions: skipped (--no-questions)")
    // Aún así, construimos el map con lo que ya hay en prod para que
    // test_questions/ai_cache_entries puedan referenciar.
    const localQs = await src.execute(`SELECT id, externalId FROM questions`)
    const prodQs  = await tgt.execute(`SELECT id, externalId FROM questions`)
    const prodMap = new Map<string, number>()
    for (const r of prodQs.rows) prodMap.set(String(r.externalId), Number(r.id))
    for (const r of localQs.rows) {
      const pid = prodMap.get(String(r.externalId))
      if (pid) idMap.set(Number(r.id), pid)
    }
    return idMap
  }

  header("Questions (con protección admin)")

  const localQs = await src.execute(
    `SELECT id, externalId, codigoTema, enunciado, explicacion, imagen, tier,
            aiGenerated, aiModel, aiReviewedAt, aiApproved
       FROM questions`,
  )
  const localQuestions = localQs.rows as unknown as LocalQuestion[]
  console.log(`  Questions en local:  ${localQuestions.length}`)

  // Estado actual de prod: id + externalId + flags de protección
  const prodQs = await tgt.execute(
    `SELECT id, externalId, lastEditedAt, aiApproved FROM questions`,
  )
  interface ProdInfo {
    id:           number
    lastEditedAt: string | null
    aiApproved:   number | null
  }
  const prodMap = new Map<string, ProdInfo>()
  for (const r of prodQs.rows) {
    prodMap.set(String(r.externalId), {
      id:           Number(r.id),
      lastEditedAt: r.lastEditedAt as string | null,
      aiApproved:   r.aiApproved as number | null,
    })
  }
  console.log(`  Questions en prod:   ${prodMap.size}`)

  let toInsert  = 0
  let toUpdate  = 0
  let protected_ = 0

  // Construir plan
  interface Action {
    kind:  "insert" | "update" | "skip"
    local: LocalQuestion
    prodId?: number
  }
  const plan: Action[] = []
  for (const lq of localQuestions) {
    const pinfo = prodMap.get(lq.externalId)
    if (!pinfo) {
      plan.push({ kind: "insert", local: lq })
      toInsert++
    } else if (cfg.respectAdminWork && (pinfo.lastEditedAt !== null || pinfo.aiApproved !== null)) {
      plan.push({ kind: "skip", local: lq, prodId: pinfo.id })
      protected_++
    } else {
      plan.push({ kind: "update", local: lq, prodId: pinfo.id })
      toUpdate++
    }
  }

  console.log(`     → INSERT (nuevas):           ${toInsert}`)
  console.log(`     → UPDATE (no protegidas):    ${toUpdate}`)
  console.log(`     → SKIP (protegidas admin):   ${protected_}`)

  if (cfg.dryRun) {
    // Aún así rellenamos el idMap con lo que ya hay para que el resto
    // del dry-run pueda continuar
    for (const a of plan) {
      if (a.prodId) idMap.set(a.local.id, a.prodId)
    }
    return idMap
  }

  // Ejecutar plan — BATCHED para reducir round-trips a Turso
  const insertQSql = `INSERT INTO questions (${QUESTION_INSERT_FIELDS.map((c) => `"${c}"`).join(",")}) VALUES (${QUESTION_INSERT_FIELDS.map(() => "?").join(",")})`
  const updateQSql = `UPDATE questions SET ${QUESTION_UPDATE_FIELDS.map((c) => `"${c}"=?`).join(",")} WHERE externalId=?`

  // 1) SKIPs: rellenar idMap, no tocan red
  for (const a of plan) {
    if (a.kind === "skip") idMap.set(a.local.id, a.prodId!)
  }

  // 2) UPDATEs en batches de 200 (sin lastInsertRowid → muy paralelizable)
  const updates = plan.filter((a) => a.kind === "update")
  const updateBatchSize = 200
  let upDone = 0
  for (let i = 0; i < updates.length; i += updateBatchSize) {
    const chunk = updates.slice(i, i + updateBatchSize)
    await tgt.batch(
      chunk.map((a) => ({
        sql:  updateQSql,
        args: [...QUESTION_UPDATE_FIELDS.map((c) => a.local[c as keyof LocalQuestion]), a.local.externalId],
      })),
      "write",
    )
    // Mapear FK: para updates, el prodId ya lo conocíamos del prodMap
    for (const a of chunk) idMap.set(a.local.id, a.prodId!)
    upDone += chunk.length
    process.stdout.write(`\r     UPDATE  ${upDone}/${updates.length}`)
  }
  if (updates.length > 0) process.stdout.write(`\n`)

  // 3) INSERTs uno a uno (necesitamos lastInsertRowid de cada uno para idMap)
  const inserts = plan.filter((a) => a.kind === "insert")
  let inDone = 0
  for (const a of inserts) {
    const res = await tgt.execute({
      sql:  insertQSql,
      args: QUESTION_INSERT_FIELDS.map((c) => a.local[c as keyof LocalQuestion]),
    })
    idMap.set(a.local.id, Number(res.lastInsertRowid))
    inDone++
    process.stdout.write(`\r     INSERT  ${inDone}/${inserts.length}`)
  }
  if (inserts.length > 0) process.stdout.write(`\n`)

  // ── Options ──────────────────────────────────────────────────────
  // Para insert/update questions, hacemos DELETE+INSERT de sus options.
  // Para skip, dejamos prod options intactas.
  header("Options (synced solo para questions no protegidas)")

  const localOpts = await src.execute(`SELECT id, questionId, letra, texto, isCorrect FROM options`)
  const optionsByQuestion = new Map<number, LocalOption[]>()
  for (const o of localOpts.rows as unknown as LocalOption[]) {
    if (!optionsByQuestion.has(o.questionId)) optionsByQuestion.set(o.questionId, [])
    optionsByQuestion.get(o.questionId)!.push(o)
  }

  const syncedQuestions = plan.filter((a) => a.kind !== "skip")
  console.log(`  Questions con options a sync:  ${syncedQuestions.length}`)
  if (cfg.dryRun) {
    let totalOpts = 0
    for (const a of syncedQuestions) totalOpts += optionsByQuestion.get(a.local.id)?.length ?? 0
    console.log(`  Total options a re-sync:       ${totalOpts}`)
    return idMap
  }

  // BATCHED: en vez de 2 round-trips por question × 2688 questions,
  // hacemos chunks de 200 questions con DELETE en bulk + INSERT en bulk.
  const insertOSql = `INSERT INTO options ("questionId","letra","texto","isCorrect") VALUES (?,?,?,?)`
  const optsBatchSize = 200
  let optsInserted = 0
  let processedQ = 0

  for (let i = 0; i < syncedQuestions.length; i += optsBatchSize) {
    const chunk = syncedQuestions.slice(i, i + optsBatchSize)
    const prodQIds = chunk.map((a) => idMap.get(a.local.id)!)

    // DELETE bulk: una sentencia con IN (?,?,?,...)
    const placeholders = prodQIds.map(() => "?").join(",")
    const stmts: InStatement[] = [
      { sql: `DELETE FROM options WHERE questionId IN (${placeholders})`, args: prodQIds },
    ]

    // INSERTs de todas las options del chunk en la misma batch
    for (const a of chunk) {
      const prodQId = idMap.get(a.local.id)!
      const opts = optionsByQuestion.get(a.local.id) ?? []
      for (const o of opts) {
        stmts.push({ sql: insertOSql, args: [prodQId, o.letra, o.texto, o.isCorrect] })
        optsInserted++
      }
    }

    await tgt.batch(stmts, "write")
    processedQ += chunk.length
    process.stdout.write(`\r     options de ${processedQ}/${syncedQuestions.length} questions  (${optsInserted} options)`)
  }
  if (syncedQuestions.length > 0) process.stdout.write(`\n`)
  console.log(`     options insertadas:         ${optsInserted}`)

  return idMap
}

/**
 * AICacheEntry: insert-only por (questionId, withImage). Si prod ya tiene
 * caché de esa pregunta, NO se reemplaza.
 */
async function syncAICache(
  src: Client,
  tgt: Client,
  cfg: SyncConfig,
  questionIdMap: Map<number, number>,
) {
  if (!cfg.syncAICache) {
    console.log("⏭  syncAICache: skipped (--no-ai-cache)")
    return
  }
  header("AICacheEntry (insert-only)")

  const localCache = await src.execute(
    `SELECT questionId, withImage, payloadJson, model, createdAt FROM ai_cache_entries`,
  )
  console.log(`  Cachés en local:    ${localCache.rows.length}`)

  if (localCache.rows.length === 0) return

  // Estado prod
  const prodCache = await tgt.execute(
    `SELECT questionId, withImage FROM ai_cache_entries`,
  )
  const prodPairs = new Set<string>()
  for (const r of prodCache.rows) {
    prodPairs.add(`${r.questionId}:${r.withImage}`)
  }
  console.log(`  Cachés en prod:     ${prodCache.rows.length}`)

  // Diff: filtrar las que prod no tiene
  interface Row { questionId: number; withImage: number; payloadJson: string; model: string; createdAt: string }
  const toInsert: Row[] = []
  let noMappedQ = 0
  for (const r of localCache.rows as unknown as Row[]) {
    const prodQId = questionIdMap.get(Number(r.questionId))
    if (!prodQId) { noMappedQ++; continue }
    const key = `${prodQId}:${r.withImage}`
    if (!prodPairs.has(key)) toInsert.push({ ...r, questionId: prodQId })
  }
  console.log(`     → A insertar:    ${toInsert.length}  ${noMappedQ > 0 ? `(skipped: ${noMappedQ} sin question en prod)` : ""}`)

  if (cfg.dryRun || toInsert.length === 0) return

  const insertSql = `INSERT INTO ai_cache_entries ("questionId","withImage","payloadJson","model","createdAt") VALUES (?,?,?,?,?)`
  for (let i = 0; i < toInsert.length; i += 50) {
    const chunk = toInsert.slice(i, i + 50)
    await tgt.batch(
      chunk.map((r) => ({ sql: insertSql, args: [r.questionId, r.withImage, r.payloadJson, r.model, r.createdAt] })),
      "write",
    )
  }
  console.log(`     insertadas:      ${toInsert.length}`)
}

/**
 * ⚠ DANGEROUS: sincroniza datos de usuario sobreescribiendo prod.
 * NO se llama por defecto — solo con --include-user-data.
 */
async function syncUserData(src: Client, tgt: Client, cfg: SyncConfig) {
  if (!cfg.syncUserData) {
    console.log("🛡  user data: PRESERVADO en prod (no se toca)")
    return
  }
  header("⚠ USER DATA (sobrescribiendo prod)")
  const tables = ["users", "exam_attempts", "answers"] as const
  for (const table of tables) {
    const { rows, columns } = await src.execute(`SELECT * FROM ${table}`)
    console.log(`  ${table.padEnd(20)} → ${rows.length} filas`)
    if (cfg.dryRun) continue
    await tgt.execute(`DELETE FROM ${table}`)
    if (rows.length === 0) continue
    const placeholders = "(" + columns.map(() => "?").join(",") + ")"
    const sql = `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(",")}) VALUES ${placeholders}`
    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50)
      await tgt.batch(batch.map((r) => ({ sql, args: columns.map((c) => r[c]) })), "write")
    }
  }
}

/**
 * ⚠ DANGEROUS: sincroniza app_config sobrescribiendo secrets de prod.
 * NO se llama por defecto — solo con --include-app-config.
 */
async function syncAppConfig(src: Client, tgt: Client, cfg: SyncConfig) {
  if (!cfg.syncAppConfig) {
    console.log("🛡  app_config: PRESERVADO en prod (secrets intactos)")
    return
  }
  header("⚠ APP_CONFIG (sobrescribiendo secrets)")
  const { rows, columns } = await src.execute(`SELECT * FROM app_config`)
  console.log(`  app_config → ${rows.length} filas`)
  if (cfg.dryRun) return
  await tgt.execute(`DELETE FROM app_config`)
  if (rows.length === 0) return
  const placeholders = "(" + columns.map(() => "?").join(",") + ")"
  const sql = `INSERT INTO app_config (${columns.map((c) => `"${c}"`).join(",")}) VALUES ${placeholders}`
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50)
    await tgt.batch(batch.map((r) => ({ sql, args: columns.map((c) => r[c]) })), "write")
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const cfg = parseArgs()

  if (!process.env.TURSO_DATABASE_URL) {
    console.error("✗ TURSO_DATABASE_URL no está definida en .env")
    process.exit(1)
  }

  const localUrl = pathToFileURL(resolve(process.cwd(), "prisma", "dev.db")).href
  const source = createClient({ url: localUrl })
  const target = createClient({
    url:       process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  console.log(`📤 Source (local): ${localUrl}`)
  console.log(`📥 Target (Turso): ${process.env.TURSO_DATABASE_URL}`)
  console.log(`\n🛠  Config:`)
  console.log(`   syncSystemData:   ${cfg.syncSystemData}`)
  console.log(`   syncQuestions:    ${cfg.syncQuestions} (respectAdminWork=${cfg.respectAdminWork})`)
  console.log(`   syncAICache:      ${cfg.syncAICache}`)
  console.log(`   syncUserData:     ${cfg.syncUserData ? "⚠ TRUE" : "false (preserved)"}`)
  console.log(`   syncAppConfig:    ${cfg.syncAppConfig ? "⚠ TRUE" : "false (preserved)"}`)
  console.log(`   dryRun:           ${cfg.dryRun}`)

  try {
    // Orden importante: questions PRIMERO para construir el idMap, después
    // categorías/tests/test_questions usan ese map para re-mapear FKs.
    const questionIdMap = await syncQuestions(source, target, cfg)
    await syncSystemData(source, target, cfg, questionIdMap)
    await syncAICache(source, target, cfg, questionIdMap)
    await syncUserData(source, target, cfg)
    await syncAppConfig(source, target, cfg)

    // Verificación final
    header("Verificación post-sync")
    for (const t of ["categories", "tests", "questions", "options", "test_questions", "manual_sections", "ai_cache_entries"] as const) {
      const r = await target.execute(`SELECT COUNT(*) AS n FROM ${t}`)
      console.log(`  ${t.padEnd(20)} ${String(r.rows[0].n).padStart(7)} filas en prod`)
    }

    if (cfg.dryRun) console.log(`\n🔍 DRY-RUN terminado. Re-ejecuta sin --dry-run para aplicar.`)
    else            console.log(`\n✅ Sincronización completa.`)
  } finally {
    source.close()
    target.close()
  }
}

main().catch((e) => {
  console.error("❌ Error:", e)
  process.exit(1)
})
