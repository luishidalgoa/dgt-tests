/**
 * Proveedor Groq (LPU inference, OpenAI-compatible API).
 *
 * Modelo configurable desde /admin → Integraciones IA (clave GROQ_MODEL).
 * Default: 'llama-3.3-70b-versatile' (best calidad/coste en su free tier).
 *
 * Características vs Gemini:
 *  + 14.400 RPD free (~58x más que Gemini Flash) → mucho margen
 *  + ~10x más rápido en latencia (LPU custom hardware)
 *  − No soporta imágenes en este wrapper (los modelos vision de Groq son
 *    "preview" y suelen cambiar). Las preguntas con imagen se procesan
 *    solo a partir del enunciado y opciones (Llama suele inferir bien
 *    el contexto de la señal por el texto).
 *
 * Mismo contrato de error: HTTP 429/503 → AIProviderError.isRateLimit.
 */

import {
  AIProviderError,
  type AIProvider,
  type AIQuestionPayload,
  type AIExplanationResult,
  type ProviderPingResult,
  type AICompleteOptions,
  type AnswerSuggestionPayload,
  type AnswerSuggestionResult,
} from "./types"

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"

async function getEnv() {
  const { getEffectiveSecret } = await import("@/lib/secretCatalog")
  const apiKey = await getEffectiveSecret("GROQ_API_KEY")
  if (!apiKey) throw new Error("Falta GROQ_API_KEY (ni .env ni /admin/secrets)")
  const { getGroqModel } = await import("@/lib/configCatalog")
  const model = await getGroqModel()
  return { apiKey, model }
}

function buildSystemPrompt(): string {
  return [
    "Eres un profesor de autoescuela español, experto en el temario del permiso B (DGT).",
    "Recibirás una pregunta del examen teórico junto con sus opciones, la opción correcta",
    "marcada explícitamente, y la explicación oficial. Tu trabajo es generar un análisis",
    "didáctico para el alumno.",
    "",
    "DEVOLVERÁS EXCLUSIVAMENTE un objeto JSON válido con esta forma exacta:",
    "{",
    '  "mainExplanation": "1-2 frases con el concepto clave en lenguaje sencillo",',
    '  "whyCorrect": "Por qué la opción correcta es la correcta, 1-3 frases",',
    '  "whyOthersWrong": { "A": "breve", "B": "breve" },',
    '  "keyPhrases": ["frase exacta de la explicación oficial", "..."]',
    "}",
    "",
    "Reglas duras:",
    "- whyOthersWrong: una entrada por CADA opción incorrecta, breve.",
    "- keyPhrases: 1 a 3 frases. Deben ser SUBSTRINGS LITERALES (case-sensitive,",
    "  sin reformular) del campo 'EXPLICACIÓN OFICIAL' para que el front pueda subrayarlas.",
    "- Responde en español.",
    "- Devuelve SOLO el JSON, sin markdown ni texto extra.",
  ].join("\n")
}

function buildUserPrompt(p: AIQuestionPayload): string {
  const optionsBlock = p.options
    .map((o) => `${o.letra.toUpperCase()}) ${o.texto}`)
    .join("\n")
  return [
    `PREGUNTA: ${p.enunciado}`,
    p.codigoTema ? `TEMA: ${p.codigoTema}` : "",
    "",
    "OPCIONES:",
    optionsBlock,
    "",
    `OPCIÓN CORRECTA: ${p.correctLetra.toUpperCase()}`,
    "",
    "EXPLICACIÓN OFICIAL:",
    p.explicacion,
  ].filter(Boolean).join("\n")
}

function stripJsonFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
}

async function explainQuestion(payload: AIQuestionPayload): Promise<AIExplanationResult> {
  const { apiKey, model } = await getEnv()

  const body = {
    model,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user",   content: buildUserPrompt(payload) },
    ],
    // Llama y mixtral soportan JSON mode en Groq. Si el modelo elegido
    // no lo admite, el servidor ignora el campo (no rompe).
    response_format: { type: "json_object" },
    // Temperatura baja → respuestas más deterministas para tareas de
    // extracción de keyPhrases.
    temperature: 0.2,
    // max_tokens conservador: nuestras respuestas son < 600 tokens
    // normalmente. Le damos margen para 4-5 opciones largas.
    max_tokens: 1024,
  }

  const res = await fetch(ENDPOINT, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new AIProviderError("groq", res.status, `Groq ${res.status}: ${text || res.statusText}`)
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const text = data.choices?.[0]?.message?.content?.trim() ?? ""
  if (!text) throw new AIProviderError("groq", 500, "Groq no devolvió texto")

  const cleaned = stripJsonFences(text)
  let parsed: Partial<AIExplanationResult> & {
    main_explanation?: string
    why_correct?: string
    why_others_wrong?: Record<string, string>
    key_phrases?: string[]
  }
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) throw new AIProviderError("groq", 500, "Respuesta de Groq no es JSON")
    parsed = JSON.parse(match[0])
  }

  return {
    mainExplanation: parsed.mainExplanation ?? parsed.main_explanation ?? "",
    whyCorrect:      parsed.whyCorrect ?? parsed.why_correct ?? "",
    whyOthersWrong:  parsed.whyOthersWrong ?? parsed.why_others_wrong ?? {},
    keyPhrases:      (parsed.keyPhrases ?? parsed.key_phrases ?? [])
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0),
    highlightLetras: [payload.correctLetra.toUpperCase()],
  }
}

/**
 * Llamada genérica al modelo. Groq usa la API compatible OpenAI, así
 * que system/user van como mensajes separados (lo natural).
 */
async function complete(
  systemPrompt: string,
  userPrompt:   string,
  opts: AICompleteOptions = {},
): Promise<string> {
  const { apiKey, model: defaultModel } = await getEnv()
  const model = opts.model ?? defaultModel

  const messages: { role: "system" | "user"; content: string }[] = []
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt })
  messages.push({ role: "user", content: userPrompt })

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens:  opts.maxTokens ?? 1024,
  }
  if (opts.jsonMode) body.response_format = { type: "json_object" }

  const res = await fetch(ENDPOINT, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new AIProviderError("groq", res.status, `Groq ${res.status}: ${text || res.statusText}`)
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const text = data.choices?.[0]?.message?.content?.trim() ?? ""
  if (!text) throw new AIProviderError("groq", 500, "Groq no devolvió texto")
  return text
}

function buildSuggestAnswerSystem(): string {
  return [
    "Eres un examinador del Reglamento General de Circulación de la DGT española y un profesor experimentado de autoescuela.",
    "Te llega una pregunta del examen teórico y debes determinar cuál de las opciones es la correcta según la normativa española vigente (Reglamento General de Circulación RD 1428/2003, Reglamento General de Conductores, Reglamento General de Vehículos y manual oficial de la DGT).",
    "",
    "Reglas:",
    "1. Rígete EXCLUSIVAMENTE por la normativa DGT española.",
    "2. La explicación oficial del temario es CONTEXTO, no una pista directa.",
    "3. Si dudas entre dos opciones, refleja la incertidumbre en confidence.",
    "4. Si encuentras referencia normativa concreta (artículo del RGC, número de señal, definición del manual), inclúyela en dgtBasis.",
    "",
    "DEVOLVERÁS EXCLUSIVAMENTE un JSON válido con esta forma exacta:",
    "{",
    '  "suggestedLetra": "A",                // letra exacta (A/B/C…), una sola',
    '  "confidence":     0.0,                // 0..1',
    '  "reasoning":      "...",              // 2-5 frases en español',
    '  "dgtBasis":       "Art. X del RGC..."  // o null',
    "}",
    "",
    "Responde en español. Sin markdown. Solo el JSON.",
  ].join("\n")
}

function buildSuggestAnswerUser(p: AnswerSuggestionPayload): string {
  const optionsBlock = p.options
    .map((o) => `${o.letra.toUpperCase()}) ${o.texto}`)
    .join("\n")
  return [
    `PREGUNTA: ${p.enunciado}`,
    p.codigoTema ? `CÓDIGO TEMA (orientativo): ${p.codigoTema}` : "",
    "",
    "OPCIONES:",
    optionsBlock,
    "",
    p.explicacionOficial
      ? `EXPLICACIÓN OFICIAL DEL TEMARIO (contexto):\n${p.explicacionOficial}`
      : "(No se adjunta explicación oficial — apóyate solo en la normativa DGT.)",
    p.imagePath
      ? "\n(Nota: esta pregunta tiene imagen asociada en el examen, pero este modelo no la procesa — apóyate solo en el texto.)"
      : "",
  ].filter(Boolean).join("\n")
}

function clamp01(n: unknown): number {
  const x = typeof n === "number" ? n : parseFloat(String(n))
  if (!Number.isFinite(x)) return 0
  if (x < 0) return 0
  if (x > 1) return Math.min(1, x > 100 ? 1 : x / 100)
  return x
}

async function suggestAnswer(payload: AnswerSuggestionPayload): Promise<AnswerSuggestionResult> {
  const { apiKey, model } = await getEnv()
  const body = {
    model,
    messages: [
      { role: "system", content: buildSuggestAnswerSystem() },
      { role: "user",   content: buildSuggestAnswerUser(payload) },
    ],
    response_format: { type: "json_object" },
    temperature:     0.1,
    max_tokens:      1024,
  }

  const res = await fetch(ENDPOINT, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body:    JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new AIProviderError("groq", res.status, `Groq ${res.status}: ${text || res.statusText}`)
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = data.choices?.[0]?.message?.content?.trim() ?? ""
  if (!text) throw new AIProviderError("groq", 500, "Groq no devolvió texto")

  const cleaned = stripJsonFences(text)
  let parsed: {
    suggestedLetra?:  string
    suggested_letra?: string
    confidence?:      number
    reasoning?:       string
    dgtBasis?:        string | null
    dgt_basis?:       string | null
  }
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) throw new AIProviderError("groq", 500, "Respuesta de Groq no es JSON")
    parsed = JSON.parse(match[0])
  }

  const validLetras = new Set(payload.options.map((o) => o.letra.toUpperCase()))
  const raw = (parsed.suggestedLetra ?? parsed.suggested_letra ?? "").toString().trim().toUpperCase()
  const m = raw.match(/[A-Z]/)
  const letter = m && validLetras.has(m[0]) ? m[0] : ""
  if (!letter) {
    throw new AIProviderError("groq", 500, `La IA devolvió una letra no válida: '${raw}'`)
  }
  const basis = parsed.dgtBasis ?? parsed.dgt_basis ?? null
  return {
    suggestedLetra: letter,
    confidence:     clamp01(parsed.confidence),
    reasoning:      (parsed.reasoning ?? "").toString().trim(),
    dgtBasis:       basis === null || basis === undefined ? null : String(basis).trim() || null,
    model,
  }
}

/**
 * Health check: llamada minimal "responde 'ok'" para verificar API key
 * y modelo. Coste: ~5 tokens, latencia típica < 500ms en Groq.
 */
async function ping(): Promise<ProviderPingResult> {
  const started = Date.now()
  try {
    const { apiKey, model } = await getEnv()
    const res = await fetch(ENDPOINT, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages:   [{ role: "user", content: "Responde solo: ok" }],
        max_tokens: 5,
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}` }
    }
    return { ok: true, latencyMs: Date.now() - started, model }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export const groqProvider: AIProvider = {
  name:        "groq",
  displayName: "Groq (Llama)",
  explainQuestion,
  suggestAnswer,
  complete,
  ping,
}
