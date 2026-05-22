/**
 * Proveedor Gemini (Google AI Studio).
 *
 * Modelo configurable desde /admin → Integraciones IA (clave GEMINI_MODEL).
 * Default: 'gemini-flash-latest' (250 RPD free tier).
 *
 * Cuota agotada (HTTP 429) o saturación temporal (503) se propagan como
 * `AIProviderError` con `isRateLimit=true` para que el endpoint los
 * traduzca a un 503 al front, donde sonner muestra un toast amigable.
 */

import fs from "node:fs/promises"
import path from "node:path"
import {
  AIProviderError,
  type AIProvider,
  type AIQuestionPayload,
  type AIExplanationResult,
  type ProviderPingResult,
  type AICompleteOptions,
} from "./types"

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models"

async function getEnv() {
  const { getEffectiveSecret } = await import("@/lib/secretCatalog")
  const apiKey = await getEffectiveSecret("GEMINI_API_KEY")
  if (!apiKey) throw new Error("Falta GEMINI_API_KEY (ni .env ni /admin/secrets)")
  const { getGeminiModel } = await import("@/lib/configCatalog")
  const model = await getGeminiModel()
  return { apiKey, model }
}

function buildPrompt(p: AIQuestionPayload): string {
  const optionsBlock = p.options
    .map((o) => `${o.letra.toUpperCase()}) ${o.texto}`)
    .join("\n")
  return [
    "Eres un profesor de autoescuela español.",
    "Te paso una pregunta del examen teórico DGT, sus opciones, la opción CORRECTA y la explicación oficial.",
    "Tu trabajo es ayudar al alumno a entender por qué la respuesta correcta es la correcta y por qué las otras no.",
    "",
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
    "",
    "Devuelve EXCLUSIVAMENTE un JSON válido (sin markdown, sin ```), con esta forma exacta:",
    "{",
    '  "mainExplanation": "1-2 frases con el concepto clave en lenguaje sencillo",',
    '  "whyCorrect": "Por qué la opción correcta es la correcta, 1-3 frases",',
    '  "whyOthersWrong": { "A": "...", "B": "...", "C": "..." } ',
    "    // Una entrada por cada opción INCORRECTA, breve.",
    '  "keyPhrases": ["frase extraída literalmente de la explicación oficial", "..."]',
    "    // 1 a 3 frases. Deben ser SUBSTRINGS EXACTOS (case-sensitive, sin reformular)",
    "    // del campo EXPLICACIÓN OFICIAL para que se puedan subrayar en pantalla.",
    "    // Elige las frases que mejor justifican la respuesta correcta.",
    "}",
    "",
    "IMPORTANTE: Responde en español. Solo el JSON, nada más.",
  ].filter(Boolean).join("\n")
}

async function readImageBase64(imageFilename: string): Promise<{ data: string; mime: string } | null> {
  try {
    const full = path.resolve(process.cwd(), "public", "images", imageFilename)
    const buf = await fs.readFile(full)
    const ext = path.extname(imageFilename).toLowerCase()
    const mime =
      ext === ".png"  ? "image/png"  :
      ext === ".jpg"  ? "image/jpeg" :
      ext === ".jpeg" ? "image/jpeg" :
      ext === ".webp" ? "image/webp" : "image/png"
    return { data: buf.toString("base64"), mime }
  } catch {
    return null
  }
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
  const url = `${ENDPOINT}/${encodeURIComponent(model)}:generateContent`

  const parts: unknown[] = [{ text: buildPrompt(payload) }]
  if (payload.imagePath) {
    const img = await readImageBase64(payload.imagePath)
    if (img) parts.push({ inline_data: { mime_type: img.mime, data: img.data } })
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "X-goog-api-key": apiKey,
    },
    body: JSON.stringify({ contents: [{ parts }] }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new AIProviderError("gemini", res.status, `Gemini ${res.status}: ${text || res.statusText}`)
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? ""
  if (!text) throw new AIProviderError("gemini", 500, "Gemini no devolvió texto")

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
    if (!match) throw new AIProviderError("gemini", 500, "Respuesta de la IA no es JSON")
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
 * Llamada genérica al modelo. Gemini no distingue 'system' como rol
 * separado — concatenamos system+user en un solo prompt, que es lo
 * que hace internamente el SDK oficial también.
 */
async function complete(
  systemPrompt: string,
  userPrompt:   string,
  opts: AICompleteOptions = {},
): Promise<string> {
  const { apiKey, model } = await getEnv()
  const url = `${ENDPOINT}/${encodeURIComponent(model)}:generateContent`

  const fullPrompt = systemPrompt
    ? `${systemPrompt}\n\n${userPrompt}`
    : userPrompt

  const generationConfig: Record<string, unknown> = {}
  if (opts.temperature !== undefined) generationConfig.temperature      = opts.temperature
  if (opts.maxTokens)                 generationConfig.maxOutputTokens  = opts.maxTokens
  if (opts.jsonMode)                  generationConfig.responseMimeType = "application/json"

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: fullPrompt }] }],
  }
  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig
  }

  const res = await fetch(url, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "X-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new AIProviderError("gemini", res.status, `Gemini ${res.status}: ${text || res.statusText}`)
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? ""
  if (!text) throw new AIProviderError("gemini", 500, "Gemini no devolvió texto")
  return text
}

/**
 * Ping = una llamada minimal "responde 'ok'" para verificar que la API key
 * y el modelo son válidos. Coste: ~10 tokens.
 */
async function ping(): Promise<ProviderPingResult> {
  const started = Date.now()
  try {
    const { apiKey, model } = await getEnv()
    const url = `${ENDPOINT}/${encodeURIComponent(model)}:generateContent`
    const res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
      body:    JSON.stringify({ contents: [{ parts: [{ text: "Responde solo: ok" }] }] }),
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

export const geminiProvider: AIProvider = {
  name:        "gemini",
  displayName: "Google Gemini",
  explainQuestion,
  complete,
  ping,
}
