/**
 * Catálogo central de TODA la configuración editable desde /admin.
 *
 * El panel admin itera este array para renderizar formularios.
 * Los getters tipados (más abajo) son la API que usa el resto del
 * código para leer cada setting con su default si no existe en DB.
 *
 * Convención de keys:
 *   - SCREAMING_SNAKE_CASE
 *   - Prefijo FEATURE_ para toggles binarios
 *   - Sin prefijo para valores escalares
 *
 * Si añades una nueva key:
 *   1. Mete la entrada en CONFIG_CATALOG
 *   2. Si quieres acceso tipado, crea un getter abajo
 *   3. Reemplaza la constante hardcoded donde se use
 */
import { getConfig } from "@/lib/appConfig"

export type ConfigCategory = "quotas" | "features" | "messages" | "integrations"

export interface ConfigEntry {
  key:          string
  type:         "number" | "boolean" | "string"
  default:      number | boolean | string
  label:        string
  description?: string
  category:     ConfigCategory
}

export const CONFIG_CATALOG: ConfigEntry[] = [
  // ── Quotas ──────────────────────────────────────────────────────
  {
    key:         "AI_TOKENS_FREE",
    type:        "number",
    default:     10,
    label:       "Tokens IA/mes · plan FREE",
    description: "Cuántas consultas a la IA puede hacer un usuario gratis al mes.",
    category:    "quotas",
  },
  {
    key:         "AI_TOKENS_PRO",
    type:        "number",
    default:     60,
    label:       "Tokens IA/mes · plan PRO",
    description: "Cuántas consultas a la IA puede hacer un suscriptor PRO al mes.",
    category:    "quotas",
  },
  {
    key:         "FREE_TEST_LIMIT",
    type:        "number",
    default:     7,
    label:       "Tests gratis (permiso B)",
    description: "Número de tests accesibles para usuarios FREE/guest en permiso-b.",
    category:    "quotas",
  },

  // ── Features ───────────────────────────────────────────────────
  {
    key:         "MAINTENANCE_MODE",
    type:        "boolean",
    default:     false,
    label:       "Modo mantenimiento",
    description: "Si está ON, todos los users ven una página 'volvemos en breve'. Solo el admin sigue accediendo.",
    category:    "features",
  },
  {
    key:         "FEATURE_COMPETIR",
    type:        "boolean",
    default:     true,
    label:       "Competir habilitado",
    description: "Si está OFF, el modo Competir se desactiva (no aparece en la nav, no se pueden crear partidas).",
    category:    "features",
  },
  {
    key:         "FEATURE_AI",
    type:        "boolean",
    default:     true,
    label:       "IA habilitada",
    description: "Si está OFF, los botones 'Analizar con IA' desaparecen y los endpoints devuelven 503.",
    category:    "features",
  },
  {
    key:         "FEATURE_REGISTRATION",
    type:        "boolean",
    default:     true,
    label:       "Registro de nuevos usuarios habilitado",
    description: "Si está OFF, /register devuelve 'Registros cerrados temporalmente'.",
    category:    "features",
  },

  // ── Messages ───────────────────────────────────────────────────
  {
    key:         "WELCOME_MESSAGE",
    type:        "string",
    default:     "¡Bienvenido a DGT Tests! Practica con todos los tests oficiales y aprueba a la primera.",
    label:       "Mensaje del modal de bienvenida",
    description: "Texto que ven los users nuevos en su primer login.",
    category:    "messages",
  },

  // ── Integraciones IA ──────────────────────────────────────────────
  {
    key:         "GEMINI_MODEL",
    type:        "string",
    default:     "gemini-flash-latest",
    label:       "Modelo Gemini (análisis de preguntas)",
    description:
      "Modelo de Google AI usado por /api/ai/explain. Valores recomendados: " +
      "'gemini-flash-latest' (calidad alta, 250 RPD free), " +
      "'gemini-2.5-flash-lite' (calidad correcta, 1000 RPD free), " +
      "'gemini-2.5-pro' (calidad máxima, 100 RPD free, latencia mayor).",
    category:    "integrations",
  },
]

// ── Getters tipados (cada uno lee BBDD con fallback al default) ──

export async function getAITokensFree(): Promise<number> {
  return getConfig("AI_TOKENS_FREE", 10)
}

export async function getAITokensPro(): Promise<number> {
  return getConfig("AI_TOKENS_PRO", 60)
}

export async function getFreeTestLimit(): Promise<number> {
  return getConfig("FREE_TEST_LIMIT", 7)
}

export async function isMaintenanceMode(): Promise<boolean> {
  return getConfig("MAINTENANCE_MODE", false)
}

export type FeatureName = "competir" | "ai" | "registration"

const FEATURE_KEY_MAP: Record<FeatureName, string> = {
  competir:     "FEATURE_COMPETIR",
  ai:           "FEATURE_AI",
  registration: "FEATURE_REGISTRATION",
}

export async function isFeatureEnabled(name: FeatureName): Promise<boolean> {
  const key = FEATURE_KEY_MAP[name]
  if (!key) return false   // key desconocida → cerrada por defecto
  return getConfig(key, true)
}

export async function getWelcomeMessage(): Promise<string> {
  const entry = CONFIG_CATALOG.find((c) => c.key === "WELCOME_MESSAGE")!
  return getConfig("WELCOME_MESSAGE", entry.default as string)
}

/**
 * Modelo de Gemini que usa /api/ai/explain. Configurable desde /admin
 * (categoría Integraciones IA). Si no hay entrada en BBDD, usa el default
 * 'gemini-flash-latest'.
 *
 * Nota: el script scripts/infer-subblock-titles.ts ignora este valor y
 * tiene su propio default 'gemini-2.5-flash-lite' (override por flag
 * --model). Esto es a propósito: el script es batch interno con quota
 * gratuita más alta, no debe depender del modelo de producción.
 */
export async function getGeminiModel(): Promise<string> {
  const entry = CONFIG_CATALOG.find((c) => c.key === "GEMINI_MODEL")!
  return getConfig("GEMINI_MODEL", entry.default as string)
}
