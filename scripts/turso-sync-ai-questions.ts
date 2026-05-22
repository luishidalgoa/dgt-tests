/**
 * Sube a Turso las preguntas generadas por IA que aún no existen allí.
 *
 *   npm run turso:sync-ai-questions             # default: solo las nuevas
 *   npm run turso:sync-ai-questions -- --dry-run
 *
 * Identifica las preguntas IA del SQLite local (aiGenerated = 1) y por
 * `externalId` (clave natural y única) detecta cuáles faltan en Turso.
 * Para cada faltante inserta la fila en `questions` + sus filas en
 * `options`, conservando el estado de aprobación (`aiApproved` puede ser
 * null/0/1: el filtro QUESTION_VISIBLE_WHERE se encarga de ocultar
 * las que no estén aprobadas).
 *
 * Importante: los IDs autoincrement NO se conservan — usamos externalId
 * como clave estable. Por eso re-leemos el id real de Turso tras insertar.
 *
 * Idempotente: ejecutarlo dos veces seguidas no hace nada la segunda vez.
 */

import { createClient, type Client } from "@libsql/client"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

interface Args {
  dryRun: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  return {
    dryRun: argv.includes("--dry-run") || argv.includes("-n"),
  }
}

interface LocalQuestion {
  id:           number
  externalId:   string
  codigoTema:   string | null
  enunciado:    string
  explicacion:  string
  imagen:       string | null
  tier:         string
  aiGenerated:  number          // 0/1
  aiModel:      string | null
  aiReviewedAt: string | null   // ISO o null
  aiApproved:   number | null   // null/0/1
}

interface LocalOption {
  id:         number
  questionId: number
  letra:      string
  texto:      string
  isCorrect:  number             // 0/1
}

const QUESTION_COLUMNS = [
  "externalId",
  "codigoTema",
  "enunciado",
  "explicacion",
  "imagen",
  "tier",
  "aiGenerated",
  "aiModel",
  "aiReviewedAt",
  "aiApproved",
] as const

const OPTION_COLUMNS = ["questionId", "letra", "texto", "isCorrect"] as const

async function main(): Promise<void> {
  const { dryRun } = parseArgs()

  if (!process.env.TURSO_DATABASE_URL) {
    console.error("✗ TURSO_DATABASE_URL no está definida en .env")
    process.exit(1)
  }

  const localUrl = pathToFileURL(resolve(process.cwd(), "prisma", "dev.db")).href
  const source: Client = createClient({ url: localUrl })
  const target: Client = createClient({
    url:       process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  console.log(`📤 Source (local): ${localUrl}`)
  console.log(`📥 Target (Turso): ${process.env.TURSO_DATABASE_URL}`)
  if (dryRun) console.log(`🔍 Modo dry-run — no escribiré nada en Turso.`)
  console.log()

  // 1) Leer todas las IA locales
  const localQs = await source.execute(
    `SELECT id, externalId, codigoTema, enunciado, explicacion, imagen, tier,
            aiGenerated, aiModel, aiReviewedAt, aiApproved
       FROM questions
      WHERE aiGenerated = 1`
  )
  const localQuestions = localQs.rows as unknown as LocalQuestion[]
  console.log(`   Preguntas IA en local: ${localQuestions.length}`)

  if (localQuestions.length === 0) {
    console.log(`\n✅ Nada que subir — no hay preguntas IA en local.`)
    source.close()
    target.close()
    return
  }

  // 2) Saber cuáles ya están en Turso (por externalId)
  const externalIds = localQuestions.map((q) => q.externalId)
  // SQLite/libsql limita el tamaño del IN; partimos en chunks por si crece.
  const chunkSize = 200
  const existingInTurso = new Set<string>()
  for (let i = 0; i < externalIds.length; i += chunkSize) {
    const chunk = externalIds.slice(i, i + chunkSize)
    const placeholders = chunk.map(() => "?").join(",")
    const r = await target.execute({
      sql:  `SELECT externalId FROM questions WHERE externalId IN (${placeholders})`,
      args: chunk,
    })
    for (const row of r.rows) existingInTurso.add(String(row.externalId))
  }
  console.log(`   De ésas, ya en Turso:   ${existingInTurso.size}`)

  // 3) Diff
  const toInsert = localQuestions.filter((q) => !existingInTurso.has(q.externalId))
  console.log(`   → A insertar en Turso: ${toInsert.length}\n`)

  if (toInsert.length === 0) {
    console.log(`✅ Turso ya tiene todas las preguntas IA locales — nada que hacer.`)
    source.close()
    target.close()
    return
  }

  if (dryRun) {
    console.log(`📋 Preguntas que SE INSERTARÍAN (primeras 10):`)
    for (const q of toInsert.slice(0, 10)) {
      const approval = q.aiApproved === null ? "pendiente" : q.aiApproved === 1 ? "aprobada" : "descartada"
      console.log(`   - [${q.externalId}] ${approval.padEnd(11)} ${q.enunciado.slice(0, 70)}${q.enunciado.length > 70 ? "..." : ""}`)
    }
    if (toInsert.length > 10) console.log(`   … y ${toInsert.length - 10} más.`)
    source.close()
    target.close()
    return
  }

  // 4) Insertar pregunta + opciones en Turso, una a una para poder mapear el
  //    nuevo id (autoincrement local ≠ autoincrement Turso).
  const qPlaceholders = "(" + QUESTION_COLUMNS.map(() => "?").join(",") + ")"
  const insertQSql = `INSERT INTO questions (${QUESTION_COLUMNS.map((c) => `"${c}"`).join(",")}) VALUES ${qPlaceholders}`

  const oPlaceholders = "(" + OPTION_COLUMNS.map(() => "?").join(",") + ")"
  const insertOSql = `INSERT INTO options (${OPTION_COLUMNS.map((c) => `"${c}"`).join(",")}) VALUES ${oPlaceholders}`

  let inserted = 0
  let optionsInserted = 0
  let skippedNoOptions = 0
  for (const q of toInsert) {
    // Leer sus opciones en local
    const localOpts = await source.execute({
      sql:  `SELECT id, questionId, letra, texto, isCorrect FROM options WHERE questionId = ? ORDER BY letra ASC`,
      args: [q.id],
    })
    const opts = localOpts.rows as unknown as LocalOption[]
    if (opts.length === 0) {
      console.log(`   ⚠ [${q.externalId}] sin opciones en local — la salto.`)
      skippedNoOptions++
      continue
    }

    // Insertar la pregunta en Turso (no podemos usar el id local — autoincrement)
    const qInsert = await target.execute({
      sql:  insertQSql,
      args: [
        q.externalId,
        q.codigoTema,
        q.enunciado,
        q.explicacion,
        q.imagen,
        q.tier,
        q.aiGenerated,
        q.aiModel,
        q.aiReviewedAt,
        q.aiApproved,
      ],
    })
    const newQuestionId = Number(qInsert.lastInsertRowid)
    if (!newQuestionId || Number.isNaN(newQuestionId)) {
      console.error(`   ✗ [${q.externalId}] no obtuve lastInsertRowid — aborto para esta pregunta.`)
      continue
    }

    // Insertar opciones referenciando el id nuevo de Turso
    await target.batch(
      opts.map((o) => ({
        sql:  insertOSql,
        args: [newQuestionId, o.letra, o.texto, o.isCorrect],
      })),
      "write"
    )
    inserted++
    optionsInserted += opts.length
    if (inserted % 10 === 0 || inserted === toInsert.length) {
      console.log(`   … ${inserted}/${toInsert.length} preguntas (${optionsInserted} opciones)`)
    }
  }

  console.log()
  console.log(`✅ Sincronización completa.`)
  console.log(`   Preguntas insertadas: ${inserted}`)
  console.log(`   Opciones insertadas:  ${optionsInserted}`)
  if (skippedNoOptions > 0) console.log(`   ⚠ Saltadas (sin opciones): ${skippedNoOptions}`)

  // 5) Verificación
  const verifyQ = await target.execute(`SELECT COUNT(*) as n FROM questions WHERE aiGenerated = 1`)
  const verifyApproved = await target.execute(
    `SELECT COUNT(*) as n FROM questions WHERE aiGenerated = 1 AND aiApproved = 1`
  )
  const verifyPending = await target.execute(
    `SELECT COUNT(*) as n FROM questions WHERE aiGenerated = 1 AND aiApproved IS NULL`
  )
  console.log()
  console.log(`📊 Estado actual de Turso:`)
  console.log(`   Total preguntas IA:    ${verifyQ.rows[0].n}`)
  console.log(`     · aprobadas:         ${verifyApproved.rows[0].n}  (visibles a usuarios)`)
  console.log(`     · pendientes review: ${verifyPending.rows[0].n}  (ocultas hasta aprobar)`)

  source.close()
  target.close()
}

main().catch((e) => {
  console.error("❌ Error:", e)
  process.exit(1)
})
