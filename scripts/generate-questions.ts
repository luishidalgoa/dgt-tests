/**
 * Genera preguntas tipo DGT con IA, sobre los sub-bloques que TIENEN
 * MENOS preguntas hoy, las guarda en BBDD con `aiGenerated=true` y
 * `aiApproved=null` (pendientes de review en /admin/review-questions).
 *
 * Las preguntas pendientes NO se muestran a usuarios hasta que un admin
 * las apruebe explícitamente desde el panel. Ver src/lib/questions.ts
 * (QUESTION_VISIBLE_WHERE) para el filtro de visibilidad.
 *
 * Uso:
 *   npm run questions:generate                               # 60 preguntas, 3 por sub-bloque, Groq
 *   npm run questions:generate -- --count 30 --per-block 3   # 30 totales
 *   npm run questions:generate -- --provider gemini          # con Gemini
 *   npm run questions:generate -- --dry-run                  # NO guarda en BBDD, solo muestra
 *   npm run questions:generate -- --model llama-3.3-70b-versatile
 *
 * Selección de sub-bloques: los que tienen MENOS preguntas humanas+aprobadas
 * (los IA pendientes/descartados NO cuentan para evitar bucles).
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { db } from "@/lib/db"
import { AIProviderError, type AICompleteOptions } from "@/lib/ai"
import type { AIProvider } from "@/lib/aiProviders/types"
import { QUESTION_VISIBLE_WHERE } from "@/lib/questions"
import { classifyCodigoTema } from "@/lib/temas"

// ── Args ────────────────────────────────────────────────────────────────

const DRY_RUN  = process.argv.includes("--dry-run")
const COUNT    = parseIntArg("--count", 60)
const PER_BLOCK = parseIntArg("--per-block", 3)
const PROVIDER_NAME: "gemini" | "groq" = (() => {
  const idx = process.argv.indexOf("--provider")
  if (idx < 0) return "groq"
  return process.argv[idx + 1] === "gemini" ? "gemini" : "groq"
})()
const MODEL_OVERRIDE = (() => {
  const idx = process.argv.indexOf("--model")
  if (idx < 0) return undefined
  return process.argv[idx + 1]
})()
const THROTTLE_MS = PROVIDER_NAME === "groq" ? 300 : 4500
const RETRY_BACKOFF_S = [30, 60, 90]

function parseIntArg(flag: string, def: number): number {
  const idx = process.argv.indexOf(flag)
  if (idx < 0) return def
  const n = parseInt(process.argv[idx + 1] ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : def
}

// ── Tipos ───────────────────────────────────────────────────────────────

interface IndiceSubBloque { codigo: string; titulo: string; _preguntas: number }
interface IndiceBloque    { codigo: string; titulo: string; _preguntas: number; subBloques: IndiceSubBloque[] }
interface IndiceTema      { codigo: string; titulo: string; _preguntas: number; bloques:    IndiceBloque[] }

interface BlockTarget {
  /** Code del sub-bloque jerárquico, ej. "1.2.5.3" */
  subBloqueCode: string
  /** Title legible */
  subBloqueTitle: string
  /** Para contexto: title del bloque padre, ej. "Los vehículos en la vía" */
  bloqueTitle:   string
  /** Para contexto: title del tema padre, ej. "El uso de las vías" */
  temaTitle:     string
  /** codigoTema con prefijo TC que se asigna a las preguntas generadas */
  codigoTemaToAssign: string
  /** Cuántas preguntas tiene actualmente (visibles a usuarios) */
  currentCount:  number
}

interface QuestionExample {
  enunciado:    string
  opciones:     { letra: string; texto: string; esCorrecta: boolean }[]
  explicacion:  string
}

type GeneratedQuestion = QuestionExample

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  // 1. Cargar manualIndice + contar preguntas visibles por sub-bloque
  const jsonPath = resolve(process.cwd(), "src/data/manualIndice.json")
  const indice = JSON.parse(readFileSync(jsonPath, "utf8")) as IndiceTema[]
  const targets = await pickTargets(indice)

  if (targets.length === 0) {
    console.log("⚠ No hay sub-bloques candidatos (todos por encima del threshold)")
    return
  }

  console.log(`\n🤖 Generación de preguntas con IA`)
  console.log(`   proveedor:  ${PROVIDER_NAME}`)
  console.log(`   modelo:     ${MODEL_OVERRIDE ?? "(el configurado en /admin)"}`)
  console.log(`   total:      ${COUNT} preguntas (${PER_BLOCK} por sub-bloque)`)
  console.log(`   sub-bloques: ${targets.length}`)
  console.log(`   modo:       ${DRY_RUN ? "DRY-RUN (no escribe BBDD)" : "REAL"}`)
  console.log(`\n📌 Sub-bloques objetivo (los que tienen menos preguntas):`)
  for (const t of targets.slice(0, 10)) {
    console.log(`   ${t.subBloqueCode.padEnd(10)} ${t.currentCount} preg actual · "${t.subBloqueTitle}"`)
  }
  if (targets.length > 10) console.log(`   … y ${targets.length - 10} más`)
  console.log()

  // 2. Resolver provider
  const provider = await loadProvider(PROVIDER_NAME)

  // 3. Procesar cada target
  let okTotal  = 0
  let errTotal = 0
  let i = 0
  for (const target of targets) {
    if (interrupted) {
      console.log(`\n⏹  Interrumpido en ${i}/${targets.length}`)
      break
    }
    i++

    const prefix = `[${i.toString().padStart(2)}/${targets.length}] ${target.subBloqueCode.padEnd(10)}`

    // Cargar ejemplos del mismo sub-bloque (si los hay)
    const examples = await loadExamples(target.codigoTemaToAssign, 3)
    if (examples.length === 0) {
      console.log(`${prefix}  ⚠ sin ejemplos, salto (el LLM necesita estilo del sub-bloque)`)
      continue
    }

    try {
      const questions = await generateForBlockWithRetry(
        provider, target, examples, PER_BLOCK, prefix
      )
      console.log(`${prefix}  ✅ ${questions.length} preguntas generadas`)
      if (!DRY_RUN) {
        await persistQuestions(target, questions, MODEL_OVERRIDE ?? PROVIDER_NAME)
      } else {
        console.log(`         (dry-run, no se guardan)`)
        for (const q of questions) {
          console.log(`         · "${q.enunciado.slice(0, 80)}…"`)
        }
      }
      okTotal += questions.length
    } catch (e) {
      errTotal++
      console.log(`${prefix}  ❌ ${(e as Error).message}`)
    }
    await sleepInterruptible(THROTTLE_MS)
  }

  console.log(`\n────────────────────────────────────`)
  console.log(`Total: ${okTotal} preguntas generadas · ${errTotal} sub-bloques con error`)
  if (!DRY_RUN && okTotal > 0) {
    console.log(`\n💡 Revísalas en http://localhost:4321/admin/review-questions`)
  }

  await db.$disconnect()
}

// ── Selección de targets ────────────────────────────────────────────────

async function pickTargets(indice: IndiceTema[]): Promise<BlockTarget[]> {
  // Recolectar todos los sub-bloques con título (los sin título saltarían
  // contexto al LLM — generar sin título queda mediocre).
  const allBlocks: BlockTarget[] = []
  for (const tema of indice) {
    for (const bloque of tema.bloques) {
      for (const sub of bloque.subBloques) {
        if (!sub.titulo) continue // sin título → saltar
        if (sub.codigo.includes(".0")) continue // bloques huérfanos
        // codigoTema con prefijo TC para asociar a las preguntas generadas.
        // Convención: "TC X.Y-Z" o "TC X.Y-Z.W" según los puntos del subCode.
        // Sub-bloque "1.2.5.3" → bloque "1.2", inner "5.3" → "TC 1.2-5.3".
        // Sub-bloque "4.1.1.1" → bloque "4.1" (tema sin decimal), inner "1.1" → "TC 4-1.1.1".
        const codigoTemaToAssign = subBloqueToCodigoTema(sub.codigo, bloque.codigo, tema.codigo)
        allBlocks.push({
          subBloqueCode:    sub.codigo,
          subBloqueTitle:   sub.titulo,
          bloqueTitle:      bloque.titulo || `Bloque ${bloque.codigo}`,
          temaTitle:        tema.titulo || `Tema ${tema.codigo}`,
          codigoTemaToAssign,
          currentCount:     0, // se rellena abajo
        })
      }
    }
  }

  // Contar preguntas visibles (humanas + IA aprobadas) por codigoTema
  // del sub-bloque. Una sola query y agrupamos en JS.
  const allQuestions = await db.question.findMany({
    where:  { ...QUESTION_VISIBLE_WHERE, codigoTema: { not: null } },
    select: { codigoTema: true },
  })
  const countByCodigo = new Map<string, number>()
  for (const q of allQuestions) {
    const cls = classifyCodigoTema(q.codigoTema)
    if (!cls?.subCode) continue
    countByCodigo.set(cls.subCode, (countByCodigo.get(cls.subCode) ?? 0) + 1)
  }
  for (const b of allBlocks) {
    b.currentCount = countByCodigo.get(b.subBloqueCode) ?? 0
  }

  // Ordenar ascendente por count + seleccionar hasta llegar a COUNT total
  allBlocks.sort((a, b) => a.currentCount - b.currentCount)
  const need = Math.ceil(COUNT / PER_BLOCK)
  return allBlocks.slice(0, need)
}

function subBloqueToCodigoTema(subCode: string, bloqueCode: string, temaCode: string): string {
  // Caso normal: bloque "1.2", sub "1.2.5.3" → codigoTema "TC 1.2-5.3"
  // Caso tema sin decimal: bloque "4.1" (tema "4"), sub "4.1.1.1" → "TC 4-1.1.1"
  const isTemaSinDecimal = !bloqueCode.includes(".") || bloqueCode === temaCode
  if (!isTemaSinDecimal) {
    // bloque "1.2", sub "1.2.5.3" → inner = "5.3"
    const inner = subCode.slice(bloqueCode.length + 1)
    return `TC ${bloqueCode}-${inner}`
  }
  // bloque "4.1", sub "4.1.1.1" → reconstruir: tema "4", primer dígito "1", resto "1.1"
  // El codigoTema usa formato "TC 4-1.1.1": tema + "-" + primer-segmento-inner + . + resto
  // Pero como sub.codigo ya tiene formato "TEMA.PRIMERSEG.RESTO", podemos:
  //   "4.1.1.1" → temaCode + "-" + lo que viene después de temaCode + "."
  const innerFromTema = subCode.slice(temaCode.length + 1) // "1.1.1"
  return `TC ${temaCode}-${innerFromTema}`
}

// ── Ejemplos del sub-bloque ─────────────────────────────────────────────

async function loadExamples(codigoTemaTC: string, n: number): Promise<QuestionExample[]> {
  // Buscamos preguntas humanas (no IA) que matcheen ese codigoTema.
  // El LIKE captura variantes con sufijos "(...)" típicos de AEOL.
  const rows = await db.question.findMany({
    where: {
      aiGenerated: false,
      codigoTema:  { startsWith: codigoTemaTC },
    },
    take:    n * 3, // pedimos más para descartar las que no encajen exacto
    include: { options: { orderBy: { letra: "asc" } } },
  })

  // Filtrar exactamente por classify (codigoTema visible normalizado)
  const filtered = rows.filter((r) => {
    const cls = classifyCodigoTema(r.codigoTema)
    return cls?.subCode &&
      `TC ${cls.bloqueCode}-${cls.subCode.slice(cls.bloqueCode.length + 1)}` === codigoTemaTC
  })

  return filtered.slice(0, n).map((q) => ({
    enunciado:   q.enunciado,
    explicacion: q.explicacion,
    opciones:    q.options.map((o) => ({
      letra:      o.letra,
      texto:      o.texto,
      esCorrecta: o.isCorrect,
    })),
  }))
}

// ── Generación con IA ───────────────────────────────────────────────────

async function generateForBlockWithRetry(
  provider: AIProvider,
  target:   BlockTarget,
  examples: QuestionExample[],
  count:    number,
  prefix:   string,
): Promise<GeneratedQuestion[]> {
  for (let attempt = 0; attempt <= RETRY_BACKOFF_S.length; attempt++) {
    try {
      return await generateForBlock(provider, target, examples, count)
    } catch (e) {
      const isRate = e instanceof AIProviderError && e.isRateLimit
      if (!isRate || attempt === RETRY_BACKOFF_S.length) throw e
      const waitS = RETRY_BACKOFF_S[attempt]
      console.log(`${prefix}  ⏳ Rate limit, esperando ${waitS}s (${attempt + 1}/${RETRY_BACKOFF_S.length})`)
      const aborted = await sleepInterruptible(waitS * 1000)
      if (aborted) throw e
    }
  }
  throw new Error("unreachable")
}

async function generateForBlock(
  provider: AIProvider,
  target:   BlockTarget,
  examples: QuestionExample[],
  count:    number,
): Promise<GeneratedQuestion[]> {
  const systemPrompt = [
    "Eres un experto en el temario del permiso de conducir B en España (DGT).",
    "Tu trabajo es generar preguntas tipo examen DGT — texto plano, SIN referencias a imágenes.",
    "",
    "REGLAS DE LAS PREGUNTAS:",
    "- En español (España), tono formal pero claro.",
    "- 3 opciones (A, B, C). UNA es correcta, las otras dos son incorrectas pero PLAUSIBLES.",
    "- Enunciado de 1-2 frases, sin trampas excesivas.",
    "- NO uses imágenes, NO digas 'observa la señal' ni 'la imagen muestra'.",
    "- Basadas en el Reglamento General de Circulación (RD 1428/2003) y normativa DGT.",
    "- Cubrir el tema indicado abajo, no salirse a otros temas.",
    "- Explicación clara de POR QUÉ la opción correcta lo es, en 1-2 frases.",
    "",
    "FORMATO DE SALIDA: JSON ESTRICTO, sin markdown:",
    "{",
    '  "preguntas": [',
    "    {",
    '      "enunciado": "...",',
    '      "opciones": [',
    '        { "letra": "A", "texto": "...", "esCorrecta": false },',
    '        { "letra": "B", "texto": "...", "esCorrecta": true },',
    '        { "letra": "C", "texto": "...", "esCorrecta": false }',
    "      ],",
    '      "explicacion": "..."',
    "    }",
    "  ]",
    "}",
  ].join("\n")

  const examplesBlock = examples.map((ex, i) => {
    const opts = ex.opciones
      .map((o) => `   ${o.letra.toUpperCase()}) ${o.texto}${o.esCorrecta ? "  ← correcta" : ""}`)
      .join("\n")
    return `Ejemplo ${i + 1}:\n   ${ex.enunciado}\n${opts}\n   Explicación: ${ex.explicacion}`
  }).join("\n\n")

  const userPrompt = [
    `CONTEXTO TEMÁTICO:`,
    `- Tema:       "${target.temaTitle}"`,
    `- Bloque:     "${target.bloqueTitle}"`,
    `- Sub-bloque: "${target.subBloqueTitle}" (código ${target.subBloqueCode})`,
    ``,
    `EJEMPLOS DEL MISMO SUB-BLOQUE (para que pilles el estilo):`,
    ``,
    examplesBlock,
    ``,
    `Genera EXACTAMENTE ${count} preguntas nuevas sobre este sub-bloque,`,
    `siguiendo el estilo de los ejemplos pero con enunciados/escenarios distintos.`,
  ].join("\n")

  const opts: AICompleteOptions = {
    jsonMode:    true,
    temperature: 0.6, // un poco más alta que para títulos: queremos variedad
    maxTokens:   2000, // 3 preguntas con explicación ≈ 1500 tokens + margen thinking
    ...(MODEL_OVERRIDE ? { model: MODEL_OVERRIDE } : {}),
  }
  const text = await provider.complete(systemPrompt, userPrompt, opts)

  // Parse robusto
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
  let parsed: { preguntas?: unknown }
  try {
    parsed = JSON.parse(cleaned) as { preguntas?: unknown }
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) {
      const preview = cleaned.slice(0, 200).replace(/\s+/g, " ")
      throw new Error(`respuesta no es JSON · "${preview}…"`)
    }
    parsed = JSON.parse(match[0]) as { preguntas?: unknown }
  }

  // Validación estricta
  if (!Array.isArray(parsed.preguntas)) {
    throw new Error("respuesta sin array 'preguntas'")
  }
  const valid: GeneratedQuestion[] = []
  for (const raw of parsed.preguntas) {
    const q = validateQuestion(raw)
    if (q) valid.push(q)
  }
  if (valid.length === 0) {
    throw new Error("ninguna pregunta pasó validación")
  }
  return valid
}

function validateQuestion(raw: unknown): GeneratedQuestion | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (typeof r.enunciado !== "string" || r.enunciado.length < 10) return null
  if (typeof r.explicacion !== "string" || r.explicacion.length < 10) return null
  if (!Array.isArray(r.opciones) || r.opciones.length !== 3) return null

  const opciones: { letra: string; texto: string; esCorrecta: boolean }[] = []
  for (const opt of r.opciones) {
    if (!opt || typeof opt !== "object") return null
    const o = opt as Record<string, unknown>
    if (typeof o.letra !== "string" || !["A", "B", "C"].includes(o.letra.toUpperCase())) return null
    if (typeof o.texto !== "string" || o.texto.length < 1) return null
    if (typeof o.esCorrecta !== "boolean") return null
    opciones.push({ letra: o.letra.toUpperCase(), texto: o.texto, esCorrecta: o.esCorrecta })
  }
  // Exactamente 1 correcta
  if (opciones.filter((o) => o.esCorrecta).length !== 1) return null

  return { enunciado: r.enunciado, opciones, explicacion: r.explicacion }
}

// ── Persistencia ────────────────────────────────────────────────────────

async function persistQuestions(
  target:    BlockTarget,
  questions: GeneratedQuestion[],
  aiModel:   string,
): Promise<void> {
  for (const q of questions) {
    await db.question.create({
      data: {
        externalId:   `ai-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        codigoTema:   target.codigoTemaToAssign,
        enunciado:    q.enunciado,
        explicacion:  q.explicacion,
        imagen:       null,
        tier:         "PRO",
        aiGenerated:  true,
        aiModel,
        aiReviewedAt: null,
        aiApproved:   null,
        options: {
          create: q.opciones.map((o) => ({
            letra:     o.letra,
            texto:     o.texto,
            isCorrect: o.esCorrecta,
          })),
        },
      },
    })
  }
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

let interrupted = false
let lastSigintAt = 0
process.on("SIGINT", () => {
  const now = Date.now()
  if (interrupted && now - lastSigintAt < 5000) {
    console.log("\n⚠ Segundo Ctrl+C en <5s — salida dura inmediata.")
    process.exit(130)
  }
  interrupted = true
  lastSigintAt = now
  console.log("\n⚠ Ctrl+C recibido. Aborto backoffs y termino el bloque actual…")
})

async function sleepInterruptible(ms: number): Promise<boolean> {
  const STEP = 250
  let elapsed = 0
  while (elapsed < ms) {
    if (interrupted) return true
    const wait = Math.min(STEP, ms - elapsed)
    await new Promise((r) => setTimeout(r, wait))
    elapsed += wait
  }
  return interrupted
}

main().catch((e) => {
  console.error("\n❌", e)
  process.exit(1)
})
