/**
 * Facade público para el resto de la app. NO hace HTTP directamente;
 * lee `AI_PROVIDER` del configCatalog y delega a la implementación
 * concreta (gemini o groq) bajo `src/lib/aiProviders/`.
 *
 * Compatibilidad: re-exporta `AIProviderError` (la clase tipada de error
 * con `isRateLimit`) y los tipos públicos para que el endpoint y los
 * tests sigan importando desde "@/lib/ai" sin saber del provider concreto.
 */

import type {
  AIProvider,
  AIQuestionPayload,
  AIExplanationResult,
  ProviderPingResult,
  AnswerSuggestionPayload,
  AnswerSuggestionResult,
} from "./aiProviders/types"

export {
  AIProviderError,
  type AIQuestionPayload,
  type AIExplanationResult,
  type ProviderPingResult,
  type AICompleteOptions,
  type AnswerSuggestionPayload,
  type AnswerSuggestionResult,
} from "./aiProviders/types"

/** Resuelve el provider activo según AI_PROVIDER en configCatalog. */
export async function getActiveProvider(): Promise<AIProvider> {
  const { getAIProvider } = await import("@/lib/configCatalog")
  const name = await getAIProvider()
  if (name === "groq") {
    const { groqProvider } = await import("./aiProviders/groq")
    return groqProvider
  }
  // Default: gemini (también si name es desconocido)
  const { geminiProvider } = await import("./aiProviders/gemini")
  return geminiProvider
}

/** Llamada principal — explica una pregunta usando el provider activo. */
export async function explainQuestion(
  payload: AIQuestionPayload,
): Promise<AIExplanationResult> {
  const provider = await getActiveProvider()
  return provider.explainQuestion(payload)
}

/**
 * Pide al provider activo que sugiera cuál es la respuesta correcta de
 * una pregunta SIN pasársela hecha — usado por /admin/questions/[id]/edit
 * como segunda opinión cuando el admin revisa una pregunta dudosa.
 * El prompt se rige por la normativa DGT española.
 */
export async function suggestAnswerForQuestion(
  payload: AnswerSuggestionPayload,
): Promise<AnswerSuggestionResult> {
  const provider = await getActiveProvider()
  return provider.suggestAnswer(payload)
}

/** Ping del provider activo (botón "Probar conexión" de /admin). */
export async function pingActiveProvider(): Promise<ProviderPingResult> {
  const provider = await getActiveProvider()
  return provider.ping()
}

/**
 * Ping de un provider concreto por nombre — útil para probar también el
 * inactivo desde /admin antes de cambiar el switch.
 */
export async function pingProvider(name: "gemini" | "groq"): Promise<ProviderPingResult> {
  if (name === "groq") {
    const { groqProvider } = await import("./aiProviders/groq")
    return groqProvider.ping()
  }
  const { geminiProvider } = await import("./aiProviders/gemini")
  return geminiProvider.ping()
}
