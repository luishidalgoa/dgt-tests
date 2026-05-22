/**
 * Cliente para Gemini (Google AI Studio).
 *
 * Devuelve siempre el mismo shape para cada pregunta:
 *
 *   {
 *     mainExplanation:     "...",
 *     whyCorrect:          "...",
 *     whyOthersWrong:      { A: "...", B: "...", C: "..." },
 *     keyPhrases:          ["frase 1", "frase 2"]
 *   }
 *
 * Las keyPhrases deben ser SUBSTRINGS exactos del campo `explicacion`
 * de la pregunta — el frontend las usa para subrayar.
 */

import fs from "node:fs/promises"
import path from "node:path"

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models"

/**
 * Error tipado para fallos de Gemini. Llevamos el código HTTP para que
 * el endpoint pueda decidir qué responder al cliente (especialmente para
 * 429 = rate limit, donde queremos un toast amigable en el front en vez
 * del 502 genérico).
 */
export class GeminiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = "GeminiError"
  }
  get isRateLimit(): boolean {
    // 429 = quota excedida (RPM o RPD). 503 ocasional cuando el modelo
    // está saturado lo tratamos igual porque al usuario le da igual la
    // distinción.
    return this.status === 429 || this.status === 503
  }
}

export interface AIQuestionPayload {
  enunciado:    string
  explicacion:  string
  codigoTema:   string | null
  options:      { letra: string; texto: string }[]
  correctLetra: string
  /** Path absoluto a la imagen (en /public/images). null → no incluir. */
  imagePath:    string | null
}

export interface AIExplanationResult {
  mainExplanation: string
  whyCorrect:      string
  whyOthersWrong:  Record<string, string>
  keyPhrases:      string[]
  /** Letra(s) que la IA considera más relevantes (informativo). */
  highlightLetras: string[]
}

async function getEnv() {
  // GEMINI_API_KEY pasa por el helper: BBDD cifrada gana, fallback env.
  const { getEffectiveSecret } = await import("@/lib/secretCatalog")
  const apiKey = await getEffectiveSecret("GEMINI_API_KEY")
  if (!apiKey) throw new Error("Falta GEMINI_API_KEY (ni .env ni /admin/secrets)")
  // Modelo configurable desde /admin → Integraciones IA. Default
  // 'gemini-flash-latest' (250 RPD free tier, mejor calidad). Si necesitas
  // más throughput cambia a 'gemini-2.5-flash-lite' (1000 RPD) desde el
  // panel sin tocar código.
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

export async function explainQuestion(payload: AIQuestionPayload): Promise<AIExplanationResult> {
  const { apiKey, model } = await getEnv()
  const url = `${ENDPOINT}/${encodeURIComponent(model)}:generateContent`

  const parts: unknown[] = [{ text: buildPrompt(payload) }]

  if (payload.imagePath) {
    const img = await readImageBase64(payload.imagePath)
    if (img) {
      parts.push({ inline_data: { mime_type: img.mime, data: img.data } })
    }
  }

  const body = {
    contents: [{ parts }],
    // El thinking budget puede estar disponible o no según modelo.
    // Lo dejamos sin tocar para usar el por defecto del modelo.
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "X-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new GeminiError(res.status, `Gemini ${res.status}: ${text || res.statusText}`)
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? ""

  if (!text) throw new Error("Gemini no devolvió texto")

  // Parsear JSON
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
    // Como fallback, intentamos buscar el primer { ... } válido
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) throw new Error("Respuesta de la IA no es JSON")
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
