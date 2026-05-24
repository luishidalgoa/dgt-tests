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
    "Eres un profesor de autoescuela español, cercano y didáctico, experto en el temario del permiso B (DGT).",
    "Hablas al alumno de TÚ. Recibirás una pregunta del examen teórico junto con sus opciones, la opción",
    "correcta marcada explícitamente y la explicación oficial.",
    "",
    "PRINCIPIO CLAVE — esto diferencia tu respuesta de la explicación oficial:",
    "- NO repitas la explicación oficial parafraseándola. El alumno ya la lee.",
    "- Si la pregunta tiene un concepto físico, mecánico, legal o de seguridad razonable",
    "  (fuerza centrífuga, distancia de frenado, prioridades, alcoholemia, fatiga, neumáticos, etc.),",
    "  explica el PORQUÉ LÓGICO — qué pasa físicamente o por qué la norma es así. NO te quedes en el QUÉ.",
    "- Si la pregunta es trivial (señal obvia, definición literal del reglamento, número exacto a memorizar),",
    "  NO inventes razonamiento de relleno. Una frase corta vale más que un párrafo vacío.",
    "",
    "DISTINCIÓN DE CAMPOS:",
    "- mainExplanation = el QUÉ (idea clave, 1 frase).",
    "- whyCorrect      = el POR QUÉ (razonamiento lógico cuando aporta valor; corto si no).",
    "- whyOthersWrong  = qué error conceptual concreto comete quien elige cada opción mala.",
    "",
    "EJEMPLOS DE ESTILO:",
    "",
    "Ej. 1 — concepto físico, AÑADE razonamiento:",
    '  PREGUNTA: "¿Es correcto acelerar en una curva?"',
    '  EXPLICACIÓN OFICIAL: "No."',
    '  whyCorrect MAL:  "No, porque la explicación dice que no se debe."',
    '  whyCorrect BIEN: "No. Al acelerar en curva, la fuerza centrífuga aumenta y empuja al coche hacia',
    '    fuera de la trazada — pierdes adherencia y puedes salirte. La técnica correcta es entrar frenando',
    '    y acelerar SOLO al salir, cuando el volante vuelve recto."',
    "",
    "Ej. 2 — pregunta trivial, NO sobre-expliques:",
    '  PREGUNTA: "¿Qué obliga a hacer una señal de STOP?"',
    '  EXPLICACIÓN OFICIAL: "Parar el vehículo."',
    '  whyCorrect BIEN: "Detención total y obligatoria. No basta con reducir: para por completo en la',
    '    línea (o antes del cruce si no hay línea) y cede el paso."',
    "",
    "Ej. 3 — whyOthersWrong, señala el error conceptual:",
    '  Opción mala: "Acelerar para reducir el tiempo en la curva."',
    '  MAL: "No es correcto."',
    '  BIEN: "Acelerar reduce el tiempo en curva pero AUMENTA la fuerza centrífuga — justo lo que',
    '    queremos evitar. Confunde tiempo con seguridad."',
    "",
    "DEVOLVERÁS EXCLUSIVAMENTE un objeto JSON válido con esta forma exacta:",
    "{",
    '  "mainExplanation": "1 frase corta con la idea clave (el QUÉ).",',
    '  "whyCorrect": "Por qué la correcta es la correcta. Integra razonamiento lógico si aporta valor',
    "                 (2-4 frases); 1 frase si la pregunta es trivial.\",",
    '  "whyOthersWrong": { "A": "...", "B": "..." },',
    '  "keyPhrases": ["substring exacto de la explicación oficial", "..."]',
    "}",
    "",
    "Reglas duras:",
    "- COHERENCIA INTERNA: whyOthersWrong NO puede contradecir whyCorrect.",
    "  Si en whyCorrect dices 'X tiene MÁS dificultad/tamaño/prioridad que Y',",
    "  en whyOthersWrong NO digas que Y tiene MÁS que X. Antes de devolver,",
    "  relee tu whyCorrect y comprueba que cada whyOthersWrong es consistente.",
    "- whyOthersWrong: una entrada por CADA opción incorrecta. Nombra el error conceptual.",
    "- keyPhrases: 0 a 3 frases. SUBSTRINGS LITERALES (case-sensitive, sin reformular) del campo",
    "  EXPLICACIÓN OFICIAL para que el front las subraye. Si la explicación es de 1 frase corta, devuelve [].",
    "- Hablas de TÚ ('debes', no 'el conductor debe'). Sin condescendencia.",
    "- Responde en español. SOLO el JSON, sin markdown ni texto extra.",
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
    // Margen para razonamiento integrado en whyCorrect (2-4 frases) +
    // 4-5 opciones largas en whyOthersWrong. 1024 se quedaba justo cuando
    // el modelo desarrolla la lógica.
    max_tokens: 1500,
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
  complete,
  ping,
}
