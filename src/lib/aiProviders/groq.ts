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
  ping,
}
