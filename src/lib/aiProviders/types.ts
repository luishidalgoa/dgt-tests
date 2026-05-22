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
 * Error tipado para fallos de cualquier proveedor de IA. Permite al endpoint
 * `/api/ai/explain` distinguir rate-limits (que se traducen a un toast
 * amigable en el front) de errores genéricos (502).
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
  /**
   * 429 = quota excedida (RPM/RPD).
   * 503 = sobrecarga temporal del servidor.
   * Para el usuario son el mismo caso ("inténtalo en unos minutos").
   */
  get isRateLimit(): boolean {
    return this.status === 429 || this.status === 503
  }
}
