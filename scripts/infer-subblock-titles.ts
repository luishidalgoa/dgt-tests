/**
 * Recorre los nodos de src/data/manualIndice.json sin título y los infiere
 * llamando a un proveedor de IA con un sample de hasta 5 preguntas
 * representativas del nodo + contexto jerárquico (tema padre + bloque padre).
 *
 * Uso:
 *   npm run manual:infer-titles                            # provider por defecto (groq, 14.4k RPD)
 *   npm run manual:infer-titles -- --provider gemini       # usa Gemini en su lugar
 *   npm run manual:infer-titles -- --model mixtral-8x7b-32768
 *                                                          # override del modelo (sin tocar BBDD)
 *   npm run manual:infer-titles -- --dry-run               # solo muestra sugerencias
 *   npm run manual:infer-titles -- --limit 5               # procesa solo los 5 primeros
 *   npm run manual:infer-titles -- --provider groq --model llama-3.1-8b-instant --limit 20
 *
 * Auth y modelo POR DEFECTO se leen de BBDD/env (compartido con el front):
 *   - Groq:   GROQ_API_KEY  + GROQ_MODEL  (default llama-3.3-70b-versatile)
 *   - Gemini: GEMINI_API_KEY + GEMINI_MODEL (default gemini-flash-latest)
 *
 * El flag --model permite usar otro modelo SOLO para esta ejecución, útil
 * si quieres tirar de un modelo más barato/rápido para el batch sin
 * cambiar el que ven los usuarios en /api/ai/explain.
 *
 * NOTA: el script NO pisa títulos no-vacíos. Si quieres re-generar uno
 * que ya tiene título, bórralo a mano antes de ejecutar.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { db } from "@/lib/db"
import { classifyCodigoTema } from "@/lib/temas"
import { AIProviderError, type AICompleteOptions } from "@/lib/ai"
import type { AIProvider } from "@/lib/aiProviders/types"

// ── Args ────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes("--dry-run")
const LIMIT   = (() => {
  const idx = process.argv.indexOf("--limit")
  if (idx < 0) return Infinity
  const n = parseInt(process.argv[idx + 1] ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : Infinity
})()
/**
 * Provider a usar — default groq porque tiene 14.400 RPD free (58x
 * más que Gemini Flash). Si quieres usar Gemini, --provider gemini.
 */
const PROVIDER_NAME: "gemini" | "groq" = (() => {
  const idx = process.argv.indexOf("--provider")
  if (idx < 0) return "groq"
  const val = process.argv[idx + 1] ?? ""
  return val === "gemini" ? "gemini" : "groq"
})()
/**
 * Modelo override SOLO para este run. Si no se pasa, el provider usa
 * GEMINI_MODEL / GROQ_MODEL de BBDD (mismo que /api/ai/explain).
 */
const MODEL_OVERRIDE: string | undefined = (() => {
  const idx = process.argv.indexOf("--model")
  if (idx < 0) return undefined
  const v = process.argv[idx + 1]
  return v && v.trim().length > 0 ? v.trim() : undefined
})()
/**
 * Throttle entre llamadas. Default ajustado por provider:
 *   - groq:   200ms  (~300 RPM, sobra free tier de 30 RPM Vision o
 *                     mucho más en text-only; ajustar con --throttle)
 *   - gemini: 4500ms (~13 RPM, debajo del límite gratuito de 15 RPM)
 */
const THROTTLE_MS = (() => {
  const idx = process.argv.indexOf("--throttle")
  if (idx >= 0) {
    const n = parseInt(process.argv[idx + 1] ?? "", 10)
    if (Number.isFinite(n) && n >= 0) return n
  }
  return PROVIDER_NAME === "groq" ? 200 : 4500
})()
const MAX_QUESTIONS_PER_NODE = 5
const RETRY_BACKOFF_S = [30, 60, 90]
const AUTOSAVE_EVERY = 25

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

// ── Manejo de Ctrl+C ────────────────────────────────────────────────────

/**
 * Flag global que el loop principal consulta entre iteraciones. Al
 * recibir SIGINT (Ctrl+C) se activa, el loop sale limpiamente al final
 * del item en curso y el bloque post-loop persiste TODO lo procesado.
 *
 * Segundo Ctrl+C en menos de 5s = salida dura sin guardar (escape
 * hatch si la API está colgada y el item en curso no termina).
 */
let interrupted = false
let lastSigintAt = 0
process.on("SIGINT", () => {
  const now = Date.now()
  if (interrupted && now - lastSigintAt < 5000) {
    console.log("\n⚠ Segundo Ctrl+C en <5s — salida dura (NO se guarda)")
    process.exit(130)
  }
  interrupted = true
  lastSigintAt = now
  console.log("\n⚠ Ctrl+C recibido. Termino el item actual y guardo… (otro Ctrl+C en 5s = salida dura)")
})

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
  const toProcess = pending.slice(0, LIMIT)

  console.log(`\n📋 ${pending.length} nodos sin título · procesando ${toProcess.length}`)
  console.log(`   proveedor: ${PROVIDER_NAME}`)
  if (MODEL_OVERRIDE) {
    console.log(`   modelo:    ${MODEL_OVERRIDE} (override CLI)`)
  } else {
    console.log(`   modelo:    el configurado en /admin para ${PROVIDER_NAME}`)
  }
  console.log(`   throttle:  ${THROTTLE_MS}ms entre llamadas (~${Math.round(60000 / Math.max(THROTTLE_MS, 1))} RPM)`)
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

  // 3) Resolver provider (Gemini o Groq según --provider)
  const provider = await loadProvider(PROVIDER_NAME)

  // 4) Procesar secuencialmente
  const results = new Map<string, string>()
  let okCount = 0
  let errCount = 0
  let i = 0
  for (const node of toProcess) {
    if (interrupted) {
      console.log(`\n⏹  Loop interrumpido en ${i}/${toProcess.length}. Guardando lo procesado…`)
      break
    }
    i++
    const questions = (byNode.get(node.codigo) ?? []).slice(0, MAX_QUESTIONS_PER_NODE)
    const prefix = `[${i.toString().padStart(3)}/${toProcess.length}] ${node.codigo.padEnd(10)} (${node.preguntas} preg)`

    if (questions.length === 0) {
      console.log(`${prefix}  ⚠ sin preguntas, salto`)
      continue
    }

    try {
      const title = await inferTitleWithRetry(provider, node, questions, prefix)
      results.set(node.codigo, title)
      okCount++
      console.log(`${prefix}  ✅ "${title}"`)

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
  console.log(`Provider: ${PROVIDER_NAME}  ·  Procesados: ${toProcess.length}  ·  OK: ${okCount}  ·  Errores: ${errCount}`)

  if (!DRY_RUN && results.size > 0) {
    const updated = applyTitles(data, results)
    writeFileSync(jsonPath, JSON.stringify(updated, null, 2) + "\n", "utf8")
    console.log(`✅ ${results.size} títulos escritos en ${jsonPath}`)
  } else if (DRY_RUN) {
    console.log(`📋 Dry-run: ${results.size} sugerencias generadas (NO escritas)`)
  }

  await db.$disconnect()
}

// ── Inferencia con retry para 429 ───────────────────────────────────────

async function inferTitleWithRetry(
  provider: AIProvider,
  node:     Node,
  questions: QuestionLite[],
  prefix:   string,
): Promise<string> {
  for (let attempt = 0; attempt <= RETRY_BACKOFF_S.length; attempt++) {
    try {
      return await inferTitle(provider, node, questions)
    } catch (e) {
      const isRate = e instanceof AIProviderError && e.isRateLimit
      if (!isRate || attempt === RETRY_BACKOFF_S.length) throw e
      const waitS = RETRY_BACKOFF_S[attempt]
      console.log(`${prefix}  ⏳ Rate limit, esperando ${waitS}s (intento ${attempt + 1}/${RETRY_BACKOFF_S.length})`)
      await sleep(waitS * 1000)
    }
  }
  throw new Error("unreachable")
}

async function inferTitle(
  provider:  AIProvider,
  node:      Node,
  questions: QuestionLite[],
): Promise<string> {
  const systemPrompt = [
    "Eres un experto en el temario del permiso de conducir B español (DGT / AEOL).",
    "Recibes varias preguntas del examen teórico que pertenecen al mismo nodo del temario,",
    "junto con su contexto jerárquico (tema padre + bloque padre).",
    "Tu trabajo es darme un TÍTULO CORTO que describa el tema concreto que abordan.",
    "",
    "Devuelves EXCLUSIVAMENTE un JSON con esta forma:  { \"titulo\": \"...\" }",
    "",
    "Reglas del título:",
    "- Entre 3 y 7 palabras, en español.",
    "- Estilo del manual de autoescuela: formal, claro, sin floritura.",
    "- Mayúscula SOLO en la primera palabra (capitalize), sin punto final.",
    "- NO repitas el título exacto del Tema o del Bloque padre — sé específico de este sub-nivel.",
    "- Sin emojis, sin signos de exclamación, sin comillas.",
  ].join("\n")

  const userPrompt = buildUserPrompt(node, questions)
  const opts: AICompleteOptions = {
    jsonMode:    true,
    temperature: 0.2,
    // 800 tokens: cubre con margen el JSON real (~30 tokens) + posibles
    // "thinking tokens" internos que Gemini 2.5 consume antes de generar
    // la respuesta visible. Antes con 200 algunos modelos respondían "".
    maxTokens:   800,
    ...(MODEL_OVERRIDE ? { model: MODEL_OVERRIDE } : {}),
  }
  const text = await provider.complete(systemPrompt, userPrompt, opts)

  // Parsear JSON robusto (algunos modelos meten ```json fences a pesar de jsonMode)
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
  let parsed: { titulo?: string }
  try {
    parsed = JSON.parse(cleaned) as { titulo?: string }
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) {
      // Mostrar lo que realmente vino para diagnosticar — sin el preview
      // estábamos a ciegas. Truncamos a 200 chars y aplastamos whitespace.
      const preview = cleaned.length === 0
        ? "(respuesta vacía)"
        : `"${cleaned.slice(0, 200).replace(/\s+/g, " ")}${cleaned.length > 200 ? "..." : ""}"`
      throw new Error(`respuesta no es JSON · recibido: ${preview}`)
    }
    parsed = JSON.parse(match[0]) as { titulo?: string }
  }
  if (!parsed.titulo || typeof parsed.titulo !== "string") {
    throw new Error("respuesta sin campo 'titulo'")
  }
  return parsed.titulo.trim()
}

function buildUserPrompt(node: Node, questions: QuestionLite[]): string {
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
    "CONTEXTO JERÁRQUICO:",
    ...contextLines,
    "",
    `PREGUNTAS DEL NODO (${questions.length}):`,
    "",
    qsBlock,
  ].join("\n")
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function loadProvider(name: "gemini" | "groq"): Promise<AIProvider> {
  if (name === "groq") {
    const { groqProvider } = await import("@/lib/aiProviders/groq")
    return groqProvider
  }
  const { geminiProvider } = await import("@/lib/aiProviders/gemini")
  return geminiProvider
}

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
