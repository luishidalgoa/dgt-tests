/**
 * Análisis IA del rendimiento del alumno (Fase 110).
 *
 * Construye el contexto desde BBDD (stats globales + sub-bloques con MÁS
 * fallos en términos ABSOLUTOS — no porcentaje — porque el usuario quiere
 * que el modelo priorice donde hay más volumen de fallos, no donde el
 * ratio es peor con poca muestra).
 *
 * Coste: 5 tokens por análisis (gestionado en el endpoint, no aquí).
 *
 * El módulo expone:
 *   - buildStatsContext(userId, stats)  → carga top sub-bloques + ejemplos
 *   - analyzeStats(provider, context)   → llamada al modelo + parseo + validación
 *   - StatsAnalysisResult               → tipo del JSON resultante
 */

import { Prisma } from "@prisma/client"
import { z } from "zod"
import { db } from "@/lib/db"
import { SQL_ATTEMPT_STATS_AND } from "@/lib/stats"
import { classifyCodigoTema } from "@/lib/temas"
import {
  getTemaInfo,
  getBloqueInfo,
  getSubBloqueInfo,
} from "@/lib/manualIndice"
import {
  AIProviderError,
  type AICompleteOptions,
  type AIProvider,
} from "@/lib/aiProviders/types"

// ── Tipos públicos ───────────────────────────────────────────────────────

export interface StatsGlobal {
  totalAttempts:  number
  totalAnswers:   number
  correctAnswers: number
}

/** Una debilidad detectada (output del modelo). */
export interface AnalysisWeakness {
  tema:        string   // ej "Otros usuarios · Peatones" o "Tema 7 · Bloque 7.3"
  fallos:      number
  comentario:  string
}

/** JSON estructurado que devuelve el modelo. */
export interface StatsAnalysisResult {
  valoracion:   string
  fortalezas:   string[]
  debilidades:  AnalysisWeakness[]
  consejos:     string[]
}

const weaknessSchema = z.object({
  tema:       z.string().min(1),
  fallos:     z.number().int().nonnegative(),
  comentario: z.string().min(1),
})

const resultSchema = z.object({
  valoracion:  z.string().min(10),
  fortalezas:  z.array(z.string().min(1)).max(5),
  debilidades: z.array(weaknessSchema).max(8),
  consejos:    z.array(z.string().min(1)).min(1).max(6),
})

// ── Contexto enviado al modelo ────────────────────────────────────────────

interface WeakBlock {
  codigoTema:    string       // ej "TC 7.3-3.1.3 (7-3.3.1)"
  /** Nombre jerárquico legible — "Tema · Bloque · Sub-bloque" cuando hay datos. */
  niveles:       string
  fallos:        number       // cantidad absoluta de respuestas incorrectas
  respondidas:   number       // total de respuestas a preguntas con este codigoTema
  /** Hasta 2 enunciados de preguntas que el usuario ha fallado, como contexto. */
  ejemplos:      string[]
}

export interface StatsContext {
  globals:     StatsGlobal
  topWeakBlocks: WeakBlock[]
}

const MAX_BLOCKS = 10
const MAX_EXAMPLES_PER_BLOCK = 2
/**
 * Mínimo de respuestas totales antes de permitir el PRIMER análisis.
 * 90 ≈ 3 tests oficiales completos (30 preguntas cada uno). Por debajo de
 * eso la IA no tiene muestra suficiente para detectar patrones reales y
 * el resultado sería un análisis genérico que no aporta valor.
 */
export const MIN_ANSWERS_FOR_ANALYSIS = 90
/**
 * Mínimo de respuestas NUEVAS desde el último análisis para permitir
 * regenerar (botón "Actualizar"). 30 = un test completo. Sin este umbral,
 * el usuario podría pulsar "Actualizar" tras responder UNA pregunta y
 * desperdiciar 5 tokens en regenerar prácticamente los mismos datos.
 */
export const MIN_NEW_ANSWERS_FOR_REFRESH = 30
/**
 * Tamaño máximo del historial de análisis por usuario. Cuando el usuario
 * supera este número, el endpoint poda los más antiguos. Suficiente para
 * ver progreso reciente sin que la tabla crezca indefinidamente.
 */
export const MAX_HISTORY_ITEMS = 5

/**
 * Carga el contexto del alumno: stats globales (que viene precomputado del
 * caller) + los top sub-bloques con más fallos absolutos + 1-2 ejemplos
 * de preguntas falladas en cada uno.
 */
export async function buildStatsContext(
  userId: number,
  globals: StatsGlobal,
): Promise<StatsContext> {
  // 1) Top codigoTema con más fallos absolutos. Excluimos los modos no-stats
  //    para no contar /test-errores ni el modo refuerzo. Una respuesta por
  //    pregunta cuenta como 1 fallo: si el alumno falla la misma pregunta
  //    en dos intentos distintos cuenta como 2 (la idea es "cuántas veces
  //    has fallado este sub-bloque", no "cuántas preguntas únicas").
  const rawWeak = await db.$queryRaw<{
    codigoTema: string
    fallos:     bigint
    respondidas: bigint
  }[]>`
    SELECT
      q.codigoTema                                                                AS codigoTema,
      SUM(CASE WHEN a.isCorrect = 0 THEN 1 ELSE 0 END)                            AS fallos,
      COUNT(a.id)                                                                  AS respondidas
    FROM answers a
    INNER JOIN questions q     ON q.id  = a.questionId
    INNER JOIN exam_attempts ea ON ea.id = a.attemptId
    WHERE ea.userId = ${userId}
      AND q.codigoTema IS NOT NULL
      ${Prisma.raw(SQL_ATTEMPT_STATS_AND)}
    GROUP BY q.codigoTema
    HAVING SUM(CASE WHEN a.isCorrect = 0 THEN 1 ELSE 0 END) > 0
    ORDER BY fallos DESC
    LIMIT ${MAX_BLOCKS}
  `

  if (rawWeak.length === 0) {
    return { globals, topWeakBlocks: [] }
  }

  // 2) Para los top codigoTema, cargar 1-2 enunciados de preguntas que el
  //    alumno haya fallado — sirve a la IA para entender "qué tipo de
  //    pregunta suele caer aquí".
  const topCodes = rawWeak.map((r) => r.codigoTema)
  const failedQuestions = await db.$queryRaw<{
    codigoTema: string
    enunciado:  string
  }[]>`
    SELECT DISTINCT q.codigoTema AS codigoTema, q.enunciado AS enunciado
    FROM answers a
    INNER JOIN questions q     ON q.id  = a.questionId
    INNER JOIN exam_attempts ea ON ea.id = a.attemptId
    WHERE ea.userId    = ${userId}
      AND a.isCorrect  = 0
      AND q.codigoTema IN (${Prisma.join(topCodes)})
      ${Prisma.raw(SQL_ATTEMPT_STATS_AND)}
  `

  const examplesByCode = new Map<string, string[]>()
  for (const r of failedQuestions) {
    const list = examplesByCode.get(r.codigoTema) ?? []
    if (list.length < MAX_EXAMPLES_PER_BLOCK) {
      list.push(r.enunciado)
      examplesByCode.set(r.codigoTema, list)
    }
  }

  // 3) Mapear cada bloque a su nombre jerárquico legible
  const topWeakBlocks: WeakBlock[] = rawWeak.map((r) => ({
    codigoTema:  r.codigoTema,
    niveles:     resolveNiveles(r.codigoTema),
    fallos:      Number(r.fallos),
    respondidas: Number(r.respondidas),
    ejemplos:    examplesByCode.get(r.codigoTema) ?? [],
  }))

  return { globals, topWeakBlocks }
}

/**
 * Convierte un codigoTema crudo en un breadcrumb legible usando los
 * helpers del manualIndice. Devuelve sólo los niveles que tienen título
 * conocido; si nada matchea, cae al propio codigoTema.
 */
function resolveNiveles(codigoTema: string): string {
  const cls = classifyCodigoTema(codigoTema)
  if (!cls) return codigoTema

  const parts: string[] = []
  const tema = getTemaInfo(cls.padreCode)
  if (tema?.titulo) parts.push(`Tema ${cls.padreCode}: ${tema.titulo}`)

  const bloque = getBloqueInfo(cls.bloqueCode)
  if (bloque?.titulo) parts.push(`Bloque ${cls.bloqueCode}: ${bloque.titulo}`)

  if (cls.subCode) {
    const sub = getSubBloqueInfo(cls.subCode)
    if (sub?.titulo) parts.push(`Sub-bloque ${cls.subCode}: ${sub.titulo}`)
  }

  return parts.length > 0 ? parts.join(" · ") : codigoTema
}

// ── Llamada al modelo ────────────────────────────────────────────────────

/**
 * Llama al provider activo con el contexto, valida la respuesta con zod
 * y devuelve el JSON parseado. Errores del provider se propagan como
 * AIProviderError (el endpoint los traduce a códigos `ai_*`).
 */
export async function analyzeStats(
  provider: AIProvider,
  ctx:      StatsContext,
): Promise<StatsAnalysisResult> {
  const systemPrompt = buildSystemPrompt()
  const userPrompt   = buildUserPrompt(ctx)

  const opts: AICompleteOptions = {
    jsonMode:    true,
    temperature: 0.4,   // un poco de creatividad para los consejos
    // 8000 tokens. El JSON visible son ~800-1500 tokens, pero los modelos
    // "thinking" de Gemini (2.5-flash, flash-latest…) gastan VARIOS miles
    // en pensamiento interno antes de generar la salida. Con 4000 hemos
    // visto que el output llegaba truncado a mitad de un comentario.
    // 8000 da margen sobrado; si tu provider/modelo no es thinking, no
    // pasa nada porque solo cobramos por los tokens realmente generados.
    maxTokens:   8000,
  }
  const text = await provider.complete(systemPrompt, userPrompt, opts)

  // Limpieza defensiva por si algún modelo mete fences markdown
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()

  let raw: unknown
  try {
    raw = JSON.parse(cleaned)
  } catch (parseErr) {
    // Intentar extraer el primer bloque { ... } por si vino con preámbulo
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (!m) {
      // Sin `}` cerrado → respuesta TRUNCADA. Si encima viene vacía, el
      // modelo ni siquiera pudo emitir output (thinking budget agotado).
      const isEmpty   = cleaned.length === 0
      const isPartial = !isEmpty && /^\s*\{/.test(cleaned)
      const preview = isEmpty
        ? "(respuesta vacía)"
        : `"${cleaned.slice(0, 300).replace(/\s+/g, " ")}${cleaned.length > 300 ? "..." : ""}"`
      const reason = isEmpty
        ? "respuesta vacía (probable thinking budget agotado)"
        : isPartial
          ? "JSON truncado a mitad (output cortado antes de cerrar el objeto)"
          : "el modelo no emitió un JSON reconocible"
      console.error(`[aiStatsAnalysis] ${reason} (provider=${provider.name}) · raw=${preview}`)
      throw new AIProviderError(provider.name, 502, `${reason} · recibido: ${preview}`)
    }
    try {
      raw = JSON.parse(m[0])
    } catch (e) {
      // El regex encontró `{...}` pero el contenido es inválido. Causa
      // típica: el output se truncó dentro de un valor de string, y el
      // último `}` que el regex agarró pertenecía a un sub-objeto previo
      // (p.ej. un item de "debilidades"), dejando dentro un string sin
      // cerrar o un campo a mitad.
      console.error(
        `[aiStatsAnalysis] JSON malformado, probable truncado del output (provider=${provider.name})\n` +
        `   parse original error: ${(parseErr as Error).message}\n` +
        `   parse del bloque {...}: ${(e as Error).message}\n` +
        `   raw recibido (primeros 500 chars):\n${cleaned.slice(0, 500)}`,
      )
      throw new AIProviderError(
        provider.name,
        502,
        `JSON truncado del modelo: ${(e as Error).message}`,
      )
    }
  }

  const parsed = resultSchema.safeParse(raw)
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ")
    console.error(`[aiStatsAnalysis] JSON no cumple schema (${provider.name}). Campos con problemas: ${fields}. Raw:`, raw)
    throw new AIProviderError(
      provider.name,
      502,
      `JSON del modelo no cumple el schema: ${fields}`,
    )
  }
  return parsed.data
}

// ── Prompts ──────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return [
    "Eres un tutor experto del temario del permiso de conducir B en España (DGT / AEOL).",
    "Analizas el rendimiento de un alumno concreto para detectar sus debilidades y darle consejos accionables.",
    "",
    "Devuelves EXCLUSIVAMENTE un JSON con esta forma:",
    "{",
    '  "valoracion":   "<2-3 frases breves valorando cómo va globalmente>",',
    '  "fortalezas":   ["<1-3 puntos donde destaca>"],',
    '  "debilidades":  [{ "tema": "Tema · Bloque · Sub-bloque", "fallos": N, "comentario": "<1-2 frases: qué tipo de pregunta suele caer aquí y por qué le falla>" }],',
    '  "consejos":     ["<3-4 consejos accionables y concretos>"]',
    "}",
    "",
    "REGLAS CLAVE:",
    "- En 'debilidades' PRIORIZA siempre la cantidad ABSOLUTA de fallos (campo `fallos`) sobre el porcentaje de error.",
    "  Si el alumno tiene 15 fallos en un sub-bloque vs 3 fallos al 80% en otro, pesa MUCHO más el primero — ahí está perdiendo más puntos potenciales.",
    "- Ordena 'debilidades' de mayor a menor `fallos`. Como mucho 5 entradas.",
    "- Para cada debilidad, usa el nombre jerárquico legible (Tema + Bloque + Sub-bloque) que se te proporciona en el contexto, no el código crudo.",
    "- En 'consejos', si tiene sentido, anímale a usar el 'Modo refuerzo IA' del Test de errores (URL /test-errores) — es un modo que mantiene los fallos en su historial aunque los acierte, para que tú puedas seguir analizando.",
    "- Tono: cercano pero respetuoso, tutea en español de España ('llevas', 'sigues'). NUNCA condescendiente, NUNCA exagerado.",
    "- Sin emojis, sin signos de exclamación múltiples, sin markdown, sin negritas con asteriscos. Texto plano.",
    "- Si los datos son escasos para alguna conclusión, dilo brevemente en vez de inventar.",
    "- 'fortalezas' puede ser un array vacío [] si no hay datos claros — no te lo inventes.",
  ].join("\n")
}

function buildUserPrompt(ctx: StatsContext): string {
  const { globals, topWeakBlocks } = ctx
  const wrong = globals.totalAnswers - globals.correctAnswers
  const accuracy = globals.totalAnswers > 0
    ? ((globals.correctAnswers / globals.totalAnswers) * 100).toFixed(1)
    : "0.0"
  const errorRate = globals.totalAnswers > 0
    ? ((wrong / globals.totalAnswers) * 100).toFixed(1)
    : "0.0"

  const lines: string[] = []
  lines.push("DATOS DEL ALUMNO:")
  lines.push("")
  lines.push(`- Tests realizados:     ${globals.totalAttempts}`)
  lines.push(`- Respuestas totales:   ${globals.totalAnswers}`)
  lines.push(`- Aciertos:             ${globals.correctAnswers} (${accuracy} %)`)
  lines.push(`- Fallos:               ${wrong} (${errorRate} %)`)
  lines.push("")

  if (topWeakBlocks.length === 0) {
    lines.push("SUB-BLOQUES CON FALLOS: ninguno. El alumno no ha fallado en ningún sub-bloque concreto todavía.")
  } else {
    lines.push(`TOP ${topWeakBlocks.length} SUB-BLOQUES CON MÁS FALLOS (orden: cantidad absoluta, no porcentaje):`)
    lines.push("")
    topWeakBlocks.forEach((b, idx) => {
      const errPct = b.respondidas > 0
        ? ((b.fallos / b.respondidas) * 100).toFixed(0)
        : "0"
      lines.push(`${idx + 1}. ${b.niveles}`)
      lines.push(`   Código: ${b.codigoTema}`)
      lines.push(`   Fallos: ${b.fallos} / ${b.respondidas} respondidas (${errPct}% de error)`)
      if (b.ejemplos.length > 0) {
        b.ejemplos.forEach((e) => {
          lines.push(`   Ejemplo de pregunta fallada: "${truncate(e, 180)}"`)
        })
      }
      lines.push("")
    })
  }

  return lines.join("\n")
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…"
}
