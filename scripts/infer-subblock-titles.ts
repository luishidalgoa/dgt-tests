/**
 * Recorre los nodos de src/data/manualIndice.json sin título y los infiere
 * llamando a Gemini con un sample de hasta 5 preguntas representativas del
 * nodo, pasándole el contexto jerárquico (tema padre + bloque padre).
 *
 * Uso:
 *   npm run manual:infer-titles                  # procesa TODOS los vacíos
 *   npm run manual:infer-titles -- --dry-run     # solo muestra sugerencias
 *   npm run manual:infer-titles -- --limit 5     # procesa solo los 5 primeros
 *   npm run manual:infer-titles -- --dry-run --limit 5
 *
 * Modelo: GEMINI_MODEL del entorno, o "gemini-flash-latest" por defecto.
 * Auth:   GEMINI_API_KEY desde BBDD encriptada (gana) o env (fallback).
 *
 * NOTA: el script NO pisa títulos no-vacíos. Si quieres re-generar uno
 * que ya tiene título, bórralo a mano antes de ejecutar.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { db } from "@/lib/db"
import { classifyCodigoTema } from "@/lib/temas"

// ── Args ────────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes("--dry-run")
const LIMIT   = (() => {
  const idx = process.argv.indexOf("--limit")
  if (idx < 0) return Infinity
  const n = parseInt(process.argv[idx + 1] ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : Infinity
})()
/**
 * Throttle entre llamadas. Gemini Free Tier ≈ 15 RPM, así que 4500ms
 * (~13 RPM) deja margen. Si tienes plan de pago puedes bajarlo con
 * `--throttle 200`. Si sigues recibiendo 429, súbelo a 6000.
 */
const THROTTLE_MS = (() => {
  const idx = process.argv.indexOf("--throttle")
  if (idx < 0) return 4500
  const n = parseInt(process.argv[idx + 1] ?? "", 10)
  return Number.isFinite(n) && n >= 0 ? n : 4500
})()
const MAX_QUESTIONS_PER_NODE = 5
/** Espera al recibir HTTP 429, en segundos. Incrementa entre reintentos. */
const RETRY_BACKOFF_S = [30, 60, 90]
/** Auto-guardar el JSON cada N éxitos para no perder trabajo si peta. */
const AUTOSAVE_EVERY = 25

// ── Constantes Gemini ───────────────────────────────────────────────────
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models"

// ── Tipos del JSON ──────────────────────────────────────────────────────
interface SubBloque { codigo: string; titulo: string; _preguntas: number }
interface Bloque    { codigo: string; titulo: string; _preguntas: number; subBloques: SubBloque[] }
interface Tema      { codigo: string; titulo: string; _preguntas: number; bloques:    Bloque[] }

interface Node {
  level:       "tema" | "bloque" | "subBloque"
  codigo:      string
  preguntas:   number
  temaCode:    string
  temaTitle:   string
  bloqueCode?: string
  bloqueTitle?: string
}

interface QuestionLite {
  enunciado: string
  options:   { letra: string; texto: string; isCorrect: boolean }[]
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const jsonPath = resolve(process.cwd(), "src/data/manualIndice.json")
  const data = JSON.parse(readFileSync(jsonPath, "utf8")) as Tema[]

  // 1) Recolectar nodos sin título (con al menos 1 pregunta)
  const pending: Node[] = []
  for (const t of data) {
    if (!t.titulo && t._preguntas > 0) {
      pending.push({
        level: "tema", codigo: t.codigo, preguntas: t._preguntas,
        temaCode: t.codigo, temaTitle: "",
      })
    }
    for (const b of t.bloques) {
      if (!b.titulo && b._preguntas > 0) {
        pending.push({
          level: "bloque", codigo: b.codigo, preguntas: b._preguntas,
          temaCode: t.codigo, temaTitle: t.titulo,
        })
      }
      for (const s of b.subBloques) {
        if (!s.titulo && s._preguntas > 0) {
          pending.push({
            level: "subBloque", codigo: s.codigo, preguntas: s._preguntas,
            temaCode: t.codigo, temaTitle: t.titulo,
            bloqueCode: b.codigo, bloqueTitle: b.titulo,
          })
        }
      }
    }
  }

  // Aplicar --limit
  const toProcess = pending.slice(0, LIMIT)

  console.log(`\n📋 ${pending.length} nodos sin título · procesando ${toProcess.length}`)
  console.log(`   throttle: ${THROTTLE_MS}ms entre llamadas (~${Math.round(60000 / Math.max(THROTTLE_MS, 1))} RPM)`)
  if (DRY_RUN) console.log(`   modo --dry-run: no se escribirá el JSON\n`)
  else          console.log(``)

  // 2) Cargar todas las preguntas e indexarlas por nodo
  const all = await db.question.findMany({
    select: {
      id: true, codigoTema: true, enunciado: true,
      options: { select: { letra: true, texto: true, isCorrect: true } },
    },
    where: { codigoTema: { not: null } },
  })
  const byNode = new Map<string, QuestionLite[]>()
  for (const q of all) {
    const cls = classifyCodigoTema(q.codigoTema)
    if (!cls) continue
    const codes: string[] = [cls.padreCode, cls.bloqueCode]
    if (cls.subCode) codes.push(cls.subCode)
    for (const code of codes) {
      if (!byNode.has(code)) byNode.set(code, [])
      byNode.get(code)!.push({ enunciado: q.enunciado, options: q.options })
    }
  }

  // 3) Auth Gemini
  const { getEffectiveSecret } = await import("@/lib/secretCatalog")
  const apiKey = await getEffectiveSecret("GEMINI_API_KEY")
  if (!apiKey) throw new Error("Falta GEMINI_API_KEY (ni .env ni /admin/secrets)")
  // Mismo default que src/lib/ai.ts: flash-lite (1000 RPD en free tier).
  // Override con env GEMINI_MODEL si quieres probar otro modelo concreto.
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite"

  // 4) Procesar uno a uno (secuencial para no saturar la API)
  const results = new Map<string, string>()
  let okCount = 0
  let errCount = 0
  let i = 0
  for (const node of toProcess) {
    i++
    const questions = (byNode.get(node.codigo) ?? []).slice(0, MAX_QUESTIONS_PER_NODE)
    const prefix = `[${i.toString().padStart(3)}/${toProcess.length}] ${node.codigo.padEnd(10)} (${node.preguntas} preg)`

    if (questions.length === 0) {
      console.log(`${prefix}  ⚠ sin preguntas, salto`)
      continue
    }

    try {
      const title = await inferTitleWithRetry(apiKey, model, node, questions, prefix)
      results.set(node.codigo, title)
      okCount++
      console.log(`${prefix}  ✅ "${title}"`)

      // Auto-save periódico para no perder trabajo si algo peta
      if (!DRY_RUN && okCount > 0 && okCount % AUTOSAVE_EVERY === 0) {
        const partial = applyTitles(data, results)
        writeFileSync(jsonPath, JSON.stringify(partial, null, 2) + "\n", "utf8")
        console.log(`   💾 auto-save (${okCount} títulos)`)
      }
    } catch (e) {
      errCount++
      console.log(`${prefix}  ❌ ${(e as Error).message}`)
    }
    await sleep(THROTTLE_MS)
  }

  // 5) Escribir o solo reportar
  console.log(`\n────────────────────────────────────`)
  console.log(`Procesados: ${toProcess.length}  ·  OK: ${okCount}  ·  Errores: ${errCount}`)

  if (!DRY_RUN && results.size > 0) {
    const updated = applyTitles(data, results)
    writeFileSync(jsonPath, JSON.stringify(updated, null, 2) + "\n", "utf8")
    console.log(`✅ ${results.size} títulos escritos en ${jsonPath}`)
  } else if (DRY_RUN) {
    console.log(`📋 Dry-run: ${results.size} sugerencias generadas (NO escritas)`)
  }

  await db.$disconnect()
}

// ── Inferencia con retry para 429 (rate limit) ──────────────────────────

/**
 * Wrap de inferTitle con reintentos automáticos cuando Gemini devuelve
 * HTTP 429 (rate limit). Espera tiempos crecientes entre reintentos.
 * Otros errores propagan sin reintento.
 */
async function inferTitleWithRetry(
  apiKey: string,
  model:  string,
  node:   Node,
  questions: QuestionLite[],
  prefix: string,
): Promise<string> {
  for (let attempt = 0; attempt <= RETRY_BACKOFF_S.length; attempt++) {
    try {
      return await inferTitle(apiKey, model, node, questions)
    } catch (e) {
      const msg = (e as Error).message
      const is429 = msg.includes("HTTP 429")
      if (!is429 || attempt === RETRY_BACKOFF_S.length) throw e
      const waitS = RETRY_BACKOFF_S[attempt]
      console.log(`${prefix}  ⏳ HTTP 429, esperando ${waitS}s antes de reintentar (intento ${attempt + 1}/${RETRY_BACKOFF_S.length})`)
      await sleep(waitS * 1000)
    }
  }
  throw new Error("unreachable")
}

// ── Inferencia (1 llamada a Gemini) ─────────────────────────────────────

async function inferTitle(
  apiKey: string,
  model:  string,
  node:   Node,
  questions: QuestionLite[],
): Promise<string> {
  const prompt = buildPrompt(node, questions)
  const url    = `${ENDPOINT}/${encodeURIComponent(model)}:generateContent`

  const res = await fetch(url, {
    method:  "POST",
    headers: {
      "Content-Type":   "application/json",
      "X-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? ""
  if (!text) throw new Error("respuesta vacía")

  // Limpiar y parsear JSON
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
  let parsed: { titulo?: string }
  try {
    parsed = JSON.parse(cleaned) as { titulo?: string }
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) throw new Error("respuesta no es JSON")
    parsed = JSON.parse(match[0]) as { titulo?: string }
  }
  if (!parsed.titulo || typeof parsed.titulo !== "string") {
    throw new Error("respuesta sin campo 'titulo'")
  }
  return parsed.titulo.trim()
}

function buildPrompt(node: Node, questions: QuestionLite[]): string {
  const contextLines: string[] = []
  if (node.temaTitle) contextLines.push(`- Tema TC ${node.temaCode}: "${node.temaTitle}"`)
  if (node.bloqueTitle && node.bloqueCode) {
    contextLines.push(`- Bloque TC ${node.bloqueCode}: "${node.bloqueTitle}"`)
  }
  const nivelLabel =
    node.level === "subBloque" ? "Sub-bloque" :
    node.level === "bloque"    ? "Bloque"      :
                                 "Tema"
  contextLines.push(`- ${nivelLabel} TC ${node.codigo}: (sin título, este es el que TÚ tienes que inferir)`)

  const qsBlock = questions
    .map((q, idx) => {
      const opts = q.options
        .map((o) => `   ${o.letra.toUpperCase()}) ${o.texto}`)
        .join("\n")
      const correct = q.options.find((o) => o.isCorrect)?.letra.toUpperCase() ?? "?"
      return `Pregunta ${idx + 1}: ${q.enunciado}\n${opts}\n   → Correcta: ${correct}`
    })
    .join("\n\n")

  return [
    "Eres un experto en el temario del permiso de conducir B español (DGT / AEOL).",
    "Te paso varias preguntas del examen teórico que pertenecen al mismo nodo del temario.",
    "Tu trabajo es darme un TÍTULO CORTO que describa el tema concreto que abordan.",
    "",
    "CONTEXTO JERÁRQUICO:",
    ...contextLines,
    "",
    `PREGUNTAS DEL NODO (${questions.length}):`,
    "",
    qsBlock,
    "",
    "Devuelve EXCLUSIVAMENTE un JSON sin markdown ni explicaciones extra:",
    '{ "titulo": "..." }',
    "",
    "Reglas del título:",
    "- Entre 3 y 7 palabras, en español.",
    "- Estilo del manual de autoescuela: formal, claro, sin floritura.",
    "- Mayúscula SOLO en la primera palabra (estilo capitalize), sin punto final.",
    "- NO repitas el título exacto del Tema o del Bloque padre — sé específico de este sub-nivel.",
    "- Sin emojis, sin signos de exclamación, sin comillas.",
  ].join("\n")
}

// ── Helpers ─────────────────────────────────────────────────────────────

function applyTitles(data: Tema[], results: Map<string, string>): Tema[] {
  return data.map((t) => ({
    ...t,
    titulo: results.get(t.codigo) ?? t.titulo,
    bloques: t.bloques.map((b) => ({
      ...b,
      titulo: results.get(b.codigo) ?? b.titulo,
      subBloques: b.subBloques.map((s) => ({
        ...s,
        titulo: results.get(s.codigo) ?? s.titulo,
      })),
    })),
  }))
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
