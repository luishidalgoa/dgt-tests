/**
 * Sube a Turso los cambios de una (o varias) preguntas concretas tras
 * editarlas en local con /admin/questions.
 *
 *   npm run turso:sync-question -- --id 123
 *   npm run turso:sync-question -- --id 123,456,789
 *   npm run turso:sync-question -- --id 123 --dry-run
 *
 * Solo UPSERTea las preguntas indicadas (y sus opciones). No toca las
 * demás filas. Idempotente: ejecutarlo dos veces da el mismo resultado.
 *
 * Estrategia:
 *   - Match en Turso por `externalId` (clave natural — el id autoincrement
 *     no coincide entre local y Turso).
 *   - UPDATE de los campos editables de Question.
 *   - DELETE + INSERT de las Options (más simple que diff fila a fila;
 *     las preguntas tienen 3 opciones, el coste es trivial).
 *
 * Coherente con `turso:sync-ai-questions` — usa la misma capa libsql y
 * el mismo patrón de credenciales.
 */

import { createClient, type Client } from "@libsql/client"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

interface Args {
  ids:    number[]
  dryRun: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes("--dry-run") || argv.includes("-n")

  // --id 1,2,3 o --id 1 --id 2
  const ids: number[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--id" && i + 1 < argv.length) {
      for (const chunk of argv[i + 1].split(",")) {
        const n = Number(chunk.trim())
        if (Number.isInteger(n) && n > 0) ids.push(n)
      }
      i++
    }
  }
  if (ids.length === 0) {
    console.error("✗ Falta --id <N> (o --id 1,2,3 para varios)")
    console.error("  Uso: npm run turso:sync-question -- --id 123")
    process.exit(1)
  }
  return { ids, dryRun }
}

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
  lastEditedAt: string | null
  lastEditedBy: number | null
}

interface LocalOption {
  questionId: number
  letra:      string
  texto:      string
  isCorrect:  number
}

async function main(): Promise<void> {
  const { ids, dryRun } = parseArgs()

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
  console.log(`🎯 Preguntas a sincronizar: ${ids.join(", ")}`)
  if (dryRun) console.log(`🔍 Modo dry-run — no escribiré nada en Turso.`)
  console.log()

  // 1) Leer las preguntas locales por id
  const placeholders = ids.map(() => "?").join(",")
  const localQs = await source.execute({
    sql: `SELECT id, externalId, codigoTema, enunciado, explicacion, imagen, tier,
                 aiGenerated, aiModel, aiReviewedAt, aiApproved,
                 lastEditedAt, lastEditedBy
            FROM questions
           WHERE id IN (${placeholders})`,
    args: ids,
  })
  const localQuestions = localQs.rows as unknown as LocalQuestion[]

  if (localQuestions.length === 0) {
    console.error(`✗ Ninguno de los ids existe en local.`)
    source.close()
    target.close()
    process.exit(1)
  }
  if (localQuestions.length < ids.length) {
    const found = new Set(localQuestions.map((q) => q.id))
    const missing = ids.filter((i) => !found.has(i))
    console.warn(`⚠ Ids no encontrados en local (los salto): ${missing.join(", ")}`)
  }

  let updated   = 0
  let inserted  = 0
  let optsTotal = 0

  for (const q of localQuestions) {
    // 2) Leer opciones locales
    const optsR = await source.execute({
      sql:  `SELECT questionId, letra, texto, isCorrect FROM options WHERE questionId = ? ORDER BY letra ASC`,
      args: [q.id],
    })
    const opts = optsR.rows as unknown as LocalOption[]
    if (opts.length === 0) {
      console.warn(`   ⚠ [${q.externalId}] sin opciones en local — la salto.`)
      continue
    }

    // 3) ¿Existe en Turso por externalId?
    const existing = await target.execute({
      sql:  `SELECT id FROM questions WHERE externalId = ?`,
      args: [q.externalId],
    })
    const existsInTurso = existing.rows.length > 0
    const tursoId = existsInTurso ? Number(existing.rows[0].id) : null

    if (dryRun) {
      const action = existsInTurso ? "UPDATE" : "INSERT"
      console.log(`   ${action} [${q.externalId}] "${q.enunciado.slice(0, 60)}${q.enunciado.length > 60 ? "..." : ""}" (${opts.length} opciones)`)
      continue
    }

    if (existsInTurso && tursoId) {
      // UPDATE en Turso
      await target.execute({
        sql: `UPDATE questions
                 SET codigoTema   = ?,
                     enunciado    = ?,
                     explicacion  = ?,
                     imagen       = ?,
                     tier         = ?,
                     aiGenerated  = ?,
                     aiModel      = ?,
                     aiReviewedAt = ?,
                     aiApproved   = ?,
                     lastEditedAt = ?,
                     lastEditedBy = ?
               WHERE id = ?`,
        args: [
          q.codigoTema,
          q.enunciado,
          q.explicacion,
          q.imagen,
          q.tier,
          q.aiGenerated,
          q.aiModel,
          q.aiReviewedAt,
          q.aiApproved,
          q.lastEditedAt,
          q.lastEditedBy,
          tursoId,
        ],
      })
      // Reemplazar opciones (DELETE + INSERT — más simple que diff)
      await target.execute({
        sql:  `DELETE FROM options WHERE questionId = ?`,
        args: [tursoId],
      })
      await target.batch(
        opts.map((o) => ({
          sql:  `INSERT INTO options (questionId, letra, texto, isCorrect) VALUES (?, ?, ?, ?)`,
          args: [tursoId, o.letra, o.texto, o.isCorrect],
        })),
        "write"
      )
      updated++
      optsTotal += opts.length
      console.log(`   ✓ UPDATE [${q.externalId}] id_turso=${tursoId}`)
    } else {
      // INSERT en Turso (pregunta no estaba aún)
      const qInsert = await target.execute({
        sql: `INSERT INTO questions (externalId, codigoTema, enunciado, explicacion, imagen, tier,
                                      aiGenerated, aiModel, aiReviewedAt, aiApproved,
                                      lastEditedAt, lastEditedBy)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          q.lastEditedAt,
          q.lastEditedBy,
        ],
      })
      const newId = Number(qInsert.lastInsertRowid)
      await target.batch(
        opts.map((o) => ({
          sql:  `INSERT INTO options (questionId, letra, texto, isCorrect) VALUES (?, ?, ?, ?)`,
          args: [newId, o.letra, o.texto, o.isCorrect],
        })),
        "write"
      )
      inserted++
      optsTotal += opts.length
      console.log(`   + INSERT [${q.externalId}] id_turso=${newId}`)
    }
  }

  console.log()
  if (dryRun) {
    console.log(`📋 Dry-run completo. Vuelve a ejecutar sin --dry-run para aplicar.`)
  } else {
    console.log(`✅ Sincronización completa.`)
    console.log(`   Preguntas actualizadas: ${updated}`)
    console.log(`   Preguntas insertadas:   ${inserted}`)
    console.log(`   Opciones escritas:      ${optsTotal}`)
  }

  source.close()
  target.close()
}

main().catch((e) => {
  console.error("❌ Error:", e)
  process.exit(1)
})
