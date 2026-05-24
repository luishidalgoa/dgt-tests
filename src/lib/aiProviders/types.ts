/**
 * Tipos compartidos por todos los proveedores de IA (Gemini, Groq, etc.).
 *
 * La interfaz `AIProvider` define lo que cada proveedor debe implementar
 * para que la app pueda intercambiarlos sin que el resto del código se
 * entere. El facade `src/lib/ai.ts` lee `AI_PROVIDER` del configCatalog
 * y delega a la implementación correspondiente.
 */

export interface AIQuestionPayload {
  enunciado:    string
  explicacion:  string
  codigoTema:   string | null
  options:      { letra: string; texto: string }[]
  correctLetra: string
  /** Filename relativo a /public/images. null → no incluir imagen. */
  imagePath:    string | null
}

export interface AIExplanationResult {
  mainExplanation: string
  whyCorrect:      string
  whyOthersWrong:  Record<string, string>
  keyPhrases:      string[]
  /** Letra(s) que el proveedor considera más relevantes (informativo). */
  highlightLetras: string[]
}

/**
 * Payload de "¿cuál crees que es la respuesta correcta?" — usado en
 * /admin/questions/[id]/edit. Diferencia clave con AIQuestionPayload:
 * NO le pasamos la `correctLetra` (queremos que el modelo la deduzca por
 * sí mismo, sin sesgar). La `explicacionOficial` se manda como contexto
 * del temario, NO como pista de cuál es la correcta.
 */
export interface AnswerSuggestionPayload {
  enunciado:          string
  /** Texto del temario o explicación oficial que sirve de marco DGT. */
  explicacionOficial: string | null
  codigoTema:         string | null
  options:            { letra: string; texto: string }[]
  /** Filename de imagen (si la hay). En Groq se ignora — text-only. */
  imagePath:          string | null
}

export interface AnswerSuggestionResult {
  /** Letra que el modelo sugiere como correcta. */
  suggestedLetra: string
  /** Confianza estimada, 0..1. El modelo la auto-evalúa. */
  confidence:     number
  /** Razonamiento breve en español, 2-5 frases. */
  reasoning:      string
  /**
   * Cita / referencia normativa DGT que justifica la respuesta:
   * artículo del Reglamento General de Circulación, señal, definición
   * del manual… Null si el modelo no lo identifica con suficiente
   * seguridad.
   */
  dgtBasis:       string | null
  /** Modelo IA que generó la sugerencia (auditoría). */
  model:          string
}

/** Resultado de un health check del proveedor (botón "Probar conexión"). */
export type ProviderPingResult =
  | { ok: true;  latencyMs: number; model: string }
  | { ok: false; error: string }

/** Opciones genéricas para .complete() — válidas en cualquier provider. */
export interface AICompleteOptions {
  /** Pide al modelo que devuelva JSON estricto. Internamente:
   *   - Gemini: setea generationConfig.responseMimeType = "application/json"
   *   - Groq:   setea response_format = { type: "json_object" } */
  jsonMode?:    boolean
  /** 0–1, default 0.2 (poco creativo, ideal para extracción). */
  temperature?: number
  /** Tope de output tokens. Default 1024. */
  maxTokens?:   number
  /**
   * Override del modelo SOLO para esta llamada. Si va, el provider lo usa
   * en vez del configurado en BBDD (GEMINI_MODEL / GROQ_MODEL). Útil
   * para scripts batch que quieren modelo distinto sin tocar config global.
   */
  model?:       string
}

export interface AIProvider {
  /** Identificador interno (también se usa para AI_PROVIDER en configCatalog). */
  readonly name: "gemini" | "groq"
  /** Nombre legible para mostrar en UI. */
  readonly displayName: string
  /** Llamada principal: explica una pregunta del examen. */
  explainQuestion(payload: AIQuestionPayload): Promise<AIExplanationResult>
  /**
   * "¿Cuál crees tú que es la respuesta correcta?" — sin pasarle la
   * solución. Usado por /admin/questions/[id]/edit para que el admin
   * obtenga una segunda opinión antes de corregir una pregunta.
   *
   * El prompt instruye al modelo a regirse por la normativa DGT
   * española (Reglamento General de Circulación + manual oficial).
   * Para providers que no aceptan imágenes (Groq), se ignora imagePath.
   */
  suggestAnswer(payload: AnswerSuggestionPayload): Promise<AnswerSuggestionResult>
  /**
   * Llamada genérica para tareas custom (scripts batch, herramientas
   * admin, etc.). Devuelve el texto crudo de la respuesta — el caller
   * se encarga de parsearlo (JSON normalmente).
   *
   * Errores HTTP 429/503 se propagan como AIProviderError.isRateLimit
   * para que el caller pueda hacer retry con backoff.
   */
  complete(systemPrompt: string, userPrompt: string, opts?: AICompleteOptions): Promise<string>
  /** Health check minimal — usado por el botón "Probar conexión" de /admin. */
  ping(): Promise<ProviderPingResult>
}

/**
 * Categoría de error de un provider de IA. El endpoint usa esto para
 * decidir el código HTTP y el mensaje amigable que devuelve al cliente.
 * NUNCA enviamos err.message crudo al usuario — siempre traducido.
 */
export type AIProviderErrorKind =
  /** 429 / 503: cuota excedida o saturación temporal. "Inténtalo en unos minutos". */
  | "rate_limit"
  /** 401 / 403 / API_KEY_INVALID / API key expirada. Es problema del admin, no del user. */
  | "misconfigured"
  /** 400 (otros): el modelo no acepta la pregunta (imagen mal, formato raro...). */
  | "bad_request"
  /** 5xx (otros): error transitorio del modelo. */
  | "server_error"
  /** Cualquier otro caso no clasificado. */
  | "unknown"

/**
 * Error tipado para fallos de cualquier proveedor de IA. El endpoint
 * `/api/ai/explain` lo mapea a un código + mensaje amigable; el front
 * muestra un toast según el código (sonner) sin filtrar nunca el
 * mensaje crudo del provider al usuario.
 */
export class AIProviderError extends Error {
  constructor(
    public readonly provider: "gemini" | "groq",
    public readonly status:   number,
    message: string,
  ) {
    super(message)
    this.name = `${provider.charAt(0).toUpperCase()}${provider.slice(1)}Error`
  }

  /** Backwards-compat: 429/503 sigue siendo "rate limit" para el front. */
  get isRateLimit(): boolean {
    return this.kind === "rate_limit"
  }

  /**
   * Clasifica el error según el HTTP status + algunas señales conocidas
   * en el mensaje (porque varios providers usan 400 para cosas distintas).
   */
  get kind(): AIProviderErrorKind {
    // 401/403: API key inválida/no autorizada
    if (this.status === 401 || this.status === 403) return "misconfigured"
    // Algunos providers (Google) devuelven 400 con reason API_KEY_INVALID
    // o API_KEY_EXPIRED — clasificar como misconfigured para que el toast
    // sea "configuración pendiente, contacta al admin" en lugar de
    // "error genérico".
    if (this.status === 400) {
      const m = this.message.toLowerCase()
      if (
        m.includes("api_key_invalid") ||
        m.includes("api key expired") ||
        m.includes("api key not valid")
      ) {
        return "misconfigured"
      }
      return "bad_request"
    }
    if (this.status === 429 || this.status === 503) return "rate_limit"
    if (this.status >= 500) return "server_error"
    return "unknown"
  }
}
