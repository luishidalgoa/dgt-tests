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
    "Eres un profesor de autoescuela español, cercano y didáctico. Hablas al alumno de tú.",
    "Te paso una pregunta del examen teórico DGT, sus opciones, la opción CORRECTA y la explicación oficial.",
    "",
    "PRINCIPIO CLAVE — esto es lo que diferencia tu respuesta de la explicación oficial:",
    "- NO repitas la explicación oficial parafraseándola. Eso ya lo lee el alumno arriba.",
    "- Si la pregunta tiene un concepto físico, mecánico, legal o de seguridad que se PUEDE razonar",
    "  (fuerza centrífuga, distancia de frenado, prioridades, alcoholemia, fatiga, neumáticos, etc.),",
    "  explica el PORQUÉ LÓGICO — qué pasa físicamente o por qué la norma es así. NO te limites al QUÉ.",
    "- Si la pregunta es trivial (señal obvia, definición literal del reglamento, número exacto que",
    "  hay que memorizar), NO inventes razonamiento de relleno. Una frase corta vale más que un párrafo vacío.",
    "",
    "DISTINCIÓN DE CAMPOS:",
    "- mainExplanation = el QUÉ (idea clave, 1 frase corta).",
    "- whyCorrect      = el POR QUÉ (aquí integras el razonamiento lógico cuando aporta valor).",
    "- whyOthersWrong  = qué error conceptual concreto comete quien elige cada opción mala.",
    "",
    "EJEMPLOS DE ESTILO (estudia la diferencia entre 'plano' y 'con razonamiento'):",
    "",
    "Ejemplo 1 — concepto físico, AÑADE razonamiento:",
    '  PREGUNTA: "¿Es correcto acelerar en una curva?"',
    '  EXPLICACIÓN OFICIAL: "No, no es correcto."',
    '  whyCorrect PLANO (mal):   "No, porque la explicación oficial dice que no se debe."',
    '  whyCorrect CON RAZÓN (bien): "No. Al acelerar en curva, la fuerza centrífuga aumenta y empuja al',
    '    coche hacia fuera de la trazada — pierdes adherencia y puedes salirte. La técnica correcta es',
    '    entrar frenando y acelerar SOLO al salir, cuando el volante vuelve recto."',
    "",
    "Ejemplo 2 — pregunta trivial, NO sobre-expliques:",
    '  PREGUNTA: "¿Qué obliga a hacer una señal de STOP?"',
    '  EXPLICACIÓN OFICIAL: "Parar el vehículo."',
    '  whyCorrect BIEN (corto y sin paja): "Detención total y obligatoria. No basta con reducir:',
    '    tienes que parar por completo en la línea (o antes del cruce si no hay línea) y luego ceder el paso."',
    "  (Solo añades el matiz 'no basta con reducir', que es donde se equivoca el alumno. Nada más.)",
    "",
    "Ejemplo 3 — prioridad en intersección, AÑADE razonamiento:",
    '  PREGUNTA: "En un cruce sin señales, dos vehículos llegan a la vez. ¿Quién tiene preferencia?"',
    '  EXPLICACIÓN OFICIAL: "El que circula por la derecha."',
    '  whyCorrect BIEN: "El que viene por tu derecha. Es la regla general española cuando no hay señal',
    '    ni semáforo. Truco para no olvidarlo: si ambos miráis a vuestra derecha, el de la derecha NO ve',
    '    a nadie a su lado, así que él pasa primero."',
    "",
    "EJEMPLO whyOthersWrong (señala el error conceptual, no solo 'es falso'):",
    '  Opción mala: "Acelerar para reducir el tiempo en la curva."',
    '  MAL: "No es correcto."',
    '  BIEN: "Acelerar reduce el tiempo en curva pero AUMENTA la fuerza centrífuga — justo lo que',
    '    queremos evitar. Confunde tiempo con seguridad."',
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
    '  "mainExplanation": "1 frase corta con la idea clave en lenguaje sencillo (el QUÉ).",',
    '  "whyCorrect": "Por qué la correcta es la correcta. Si la pregunta da pie a razonamiento físico/lógico,',
    "                  INTEGRA el porqué aquí (2-4 frases). Si es trivial, 1 frase basta. Hablas de tú.\",",
    '  "whyOthersWrong": { "A": "...", "B": "..." }, ',
    "    // Una entrada por cada opción INCORRECTA. Nombra el error conceptual concreto.",
    '  "keyPhrases": ["substring exacto de la explicación oficial", "..."]',
    "    // 0 a 3 frases. Deben ser SUBSTRINGS EXACTOS (case-sensitive, sin reformular) de la",
    "    // EXPLICACIÓN OFICIAL para que se subrayen en pantalla. Si la explicación es de 1 frase corta,",
    "    // devuelve [] en vez de duplicarla entera.",
    "    // CRÍTICO: NO añadas ni quites comas, puntos, dos puntos, paréntesis ni",
    "    // espacios respecto al original. Copia el substring literal CARÁCTER A",
    "    // CARÁCTER de la explicación oficial. Si dudas, devuelve uno menos —",
    "    // mejor ningún subrayado que un substring inventado que no matcheará.",
    "}",
    "",
    "REGLAS DURAS:",
    "- COHERENCIA INTERNA: whyOthersWrong NO puede contradecir whyCorrect.",
    "  Si en whyCorrect dices 'X tiene MÁS dificultad/tamaño/prioridad que Y',",
    "  en whyOthersWrong NO digas que Y tiene MÁS que X. Antes de devolver,",
    "  relee tu whyCorrect y comprueba que cada whyOthersWrong es consistente.",
    "- Hablas de TÚ. Nada de 'el conductor debe' — di 'debes'.",
    "- NO uses condescendencia ('como bien sabes', 'recuerda que…').",
    "- Responde en español. Solo el JSON, nada más.",
  ].filter(Boolean).join("\n")
}

/**
 * Lee la imagen vía HTTP fetch al CDN público de Vercel (o al dev server
 * en local), no del filesystem. Por qué:
 *  - El approach anterior con `path.resolve(process.cwd(), "public",
 *    "images", imageFilename)` hacía que Turbopack traceara las 10.584
 *    imágenes del catálogo como "potencialmente requeridas runtime" y
 *    las bundleara en CADA lambda que importa gemini.ts → ~200MB de
 *    bloat por lambda → superaba el límite Vercel de 250MB.
 *  - Con fetch al CDN, el lambda no necesita las imágenes localmente.
 *    Vercel sirve `/images/X.jpg` desde su CDN edge (rápido) y el
 *    lambda solo hace una HTTP request.
 *  - Trade-off: +50ms de latencia HTTP. Aceptable para un endpoint
 *    que ya tarda 2-3s en respuesta de Gemini.
 */
async function readImageBase64(imageFilename: string): Promise<{ data: string; mime: string } | null> {
  // Usa el helper imageUrl que respeta NEXT_PUBLIC_IMAGE_CDN_URL si está
  // configurado (prod, CDN externo R2). Fallback a APP_URL/images/ en dev
  // local sin CDN configurado.
  const { absoluteImageUrl } = await import("@/lib/imageUrl")
  try {
    const res = await fetch(absoluteImageUrl(imageFilename))
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
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
    body: JSON.stringify({
      contents: [{ parts }],
      // Margen amplio para que el modelo tenga sitio tanto para "thinking"
      // (Gemini 2.5 Flash gasta tokens ocultos antes de generar) como para
      // la respuesta JSON con razonamiento integrado. Si se quedara corto
      // veríamos finishReason=MAX_TOKENS y texto vacío.
      generationConfig: { maxOutputTokens: 2048 },
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new AIProviderError("gemini", res.status, `Gemini ${res.status}: ${text || res.statusText}`)
  }

  const data = (await res.json()) as {
    candidates?: {
      content?:      { parts?: { text?: string }[] }
      finishReason?: string
    }[]
    promptFeedback?: { blockReason?: string }
  }
  const candidate = data.candidates?.[0]
  const text =
    candidate?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? ""
  if (!text) {
    const reason = candidate?.finishReason ?? data.promptFeedback?.blockReason ?? "unknown"
    throw new AIProviderError("gemini", 500, `Gemini no devolvió texto (finishReason=${reason})`)
  }

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
  const { apiKey, model: defaultModel } = await getEnv()
  const model = opts.model ?? defaultModel
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
    candidates?: {
      content?:      { parts?: { text?: string }[] }
      finishReason?: string
    }[]
    promptFeedback?: { blockReason?: string }
  }
  const candidate = data.candidates?.[0]
  const text =
    candidate?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? ""
  if (!text) {
    // Caso común: finishReason="MAX_TOKENS" cuando el modelo consumió todos
    // los tokens en "thinking" antes de generar la respuesta. Reportamos
    // el motivo para que el caller pueda actuar (subir maxTokens, etc.).
    const reason = candidate?.finishReason ?? data.promptFeedback?.blockReason ?? "unknown"
    throw new AIProviderError(
      "gemini",
      500,
      `Gemini no devolvió texto (finishReason=${reason})`
    )
  }
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
