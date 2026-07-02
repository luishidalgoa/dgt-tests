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

export type ConfigCategory = "quotas" | "features" | "messages" | "integrations" | "email"

export interface ConfigOption {
  /** Valor que se guarda en BBDD. */
  value:        string
  /** Título corto: aparece como nombre de la opción. */
  label:        string
  /** Una línea opcional debajo del label, solo se usa en variant 'cards'. */
  subtitle?:    string
  /** Texto largo descriptivo. En variant 'select' aparece debajo del select;
   *  en variant 'cards' aparece como "footer" del grupo cuando esta opción
   *  está seleccionada. */
  description?: string
  /** Hint para mostrar un icono en variant 'cards'. Valores soportados:
   *  'sparkles', 'zap', 'brain', 'cpu'. Otros se ignoran. */
  iconHint?:    string
}

export interface ConfigEntry {
  key:          string
  type:         "number" | "boolean" | "string"
  default:      number | boolean | string
  label:        string
  description?: string
  category:     ConfigCategory
  /**
   * Si se define, el campo se renderiza con un selector (dropdown o cards)
   * en vez del input/textarea por defecto. Solo aplica a entries 'string'.
   */
  options?:     ConfigOption[]
  /**
   * Cómo renderizar las options:
   *  - 'select' (default): <select> nativo con descripción debajo.
   *  - 'cards':            cards horizontales tipo radio (con icono y
   *                        subtitle). Útil para elegir entre 2-4 opciones
   *                        muy visuales (p.ej. proveedor de IA).
   */
  optionVariant?: "select" | "cards"
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
  {
    key:         "SEO_EXPOSE_PRO_QUESTIONS",
    type:        "boolean",
    default:     false,
    label:       "Exponer preguntas PRO en URLs públicas (SEO)",
    description: "Si está ON, las páginas /preguntas/[cat]/[slug] sirven cualquier pregunta del banco (FREE + PRO) y el sitemap.xml las incluye todas — Google las indexa y rankean para queries long-tail. El ÍNDICE /preguntas y la sección 'otras preguntas relacionadas' siguen mostrando solo las FREE, así el usuario casual no descubre las PRO navegando por el app. Si está OFF, solo se publican las ~210 FREE (las de los 7 primeros tests de Permiso B) y las PRO devuelven 404. Default OFF — flipea cuando estés listo para regalar visibilidad SEO de las ~2.500 PRO.",
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
    key:           "AI_PROVIDER",
    type:          "string",
    default:       "gemini",
    label:         "Proveedor de IA",
    description:   "Motor de IA que se usa en /api/ai/explain. Puedes cambiarlo en caliente sin reiniciar.",
    category:      "integrations",
    optionVariant: "cards",
    options: [
      {
        value:       "gemini",
        label:       "Google Gemini",
        subtitle:    "Multimodal · 250 RPD free",
        iconHint:    "sparkles",
        description: "Modelos Gemini de Google AI. Multimodal (entiende imágenes de señales DGT). Free tier limitado a 250 RPD en Flash. La API key se gestiona en /admin/secrets como GEMINI_API_KEY.",
      },
      {
        value:       "groq",
        label:       "Groq (Llama)",
        subtitle:    "Ultra rápido · 14.400 RPD free",
        iconHint:    "zap",
        description: "Inferencia ultrarrápida sobre modelos Llama 3.x mediante LPU. Free tier muy generoso (14.400 RPD). NO procesa imágenes en esta versión — las preguntas con foto se analizan solo a partir del texto. API key en /admin/secrets como GROQ_API_KEY.",
      },
    ],
  },
  {
    key:         "GEMINI_MODEL",
    type:        "string",
    default:     "gemini-flash-latest",
    label:       "Modelo Gemini (análisis de preguntas)",
    description: "Modelo de Google AI que usa /api/ai/explain para generar las explicaciones de las preguntas.",
    category:    "integrations",
    options: [
      {
        value:       "gemini-flash-latest",
        label:       "Gemini Flash · latest (recomendado)",
        description: "Alias dinámico al último Flash estable. Razonamiento profundo, buena comprensión de matices legales DGT. Free tier: 250 RPD. Latencia ~2-3s.",
      },
      {
        value:       "gemini-2.5-flash-lite",
        label:       "Gemini 2.5 Flash-Lite",
        description: "Optimizado para velocidad. Calidad correcta para análisis estándar pero peor en casos límite con varias excepciones. Free tier: 1000 RPD (4x más que Flash). Latencia ~1s.",
      },
      {
        value:       "gemini-2.5-pro",
        label:       "Gemini 2.5 Pro",
        description: "Modelo más capaz. Excelente en casos trampa y razonamiento extenso. Free tier: 100 RPD (2.5x menos que Flash). Latencia ~4-6s. Coste mayor en plan pagado.",
      },
      {
        value:       "gemini-2.5-flash",
        label:       "Gemini 2.5 Flash · versión fijada",
        description: "Apunta a la versión 2.5 concreta de Flash, sin auto-actualizar. Útil si quieres estabilidad absoluta. Mismas cuotas y rendimiento que 'flash-latest' hoy mismo.",
      },
    ],
  },
  {
    key:         "GROQ_MODEL",
    type:        "string",
    default:     "llama-3.3-70b-versatile",
    label:       "Modelo Groq (Llama)",
    description: "Modelo de Llama que ejecuta Groq para /api/ai/explain (solo aplica si AI_PROVIDER=groq).",
    category:    "integrations",
    options: [
      {
        value:       "llama-3.3-70b-versatile",
        label:       "Llama 3.3 70B Versatile (recomendado)",
        description: "Modelo grande, calidad alta en español y razonamiento legal. Free tier: ~14.400 RPD · 100k TPD. Mejor relación calidad/coste.",
      },
      {
        value:       "llama-3.1-8b-instant",
        label:       "Llama 3.1 8B Instant",
        description: "Modelo pequeño, latencia bajísima (<300ms). Calidad menor para preguntas con matices. Útil para muchísimas llamadas o tareas simples.",
      },
      {
        value:       "mixtral-8x7b-32768",
        label:       "Mixtral 8x7B (32k contexto)",
        description: "Mixture-of-Experts de Mistral con contexto largo. Buen español, calidad media-alta. Útil como fallback si Llama agota cuota.",
      },
      {
        value:       "gemma2-9b-it",
        label:       "Gemma 2 9B Instruct",
        description: "Modelo de Google ejecutado en Groq LPU. Calidad correcta, latencia baja. Útil para A/B testing.",
      },
    ],
  },

  // ── Email / SMTP (saliente) ───────────────────────────────────────
  // El envío usa SMTP (por defecto Resend). Estos 4 valores son editables
  // en caliente desde /admin; la contraseña / API key va en /admin/secrets
  // como RESEND_API_KEY. El mailer (src/lib/mailer.ts) los lee con estos
  // defaults si no hay valor en BBDD ni en env var del mismo nombre.
  {
    key:         "MAIL_FROM",
    type:        "string",
    default:     "DGT-TESTS <noreply@hdglabs.com>",
    label:       "Remitente (From) de los emails",
    description: "Dirección + nombre visible del remitente, formato 'Nombre <email@dominio>'. El dominio DEBE estar verificado en el proveedor SMTP (Resend). Se aplica a emails de usuario y alertas admin.",
    category:    "email",
  },
  {
    key:         "SMTP_HOST",
    type:        "string",
    default:     "smtp.resend.com",
    label:       "SMTP · Host",
    description: "Servidor SMTP de salida. Por defecto Resend. Cámbialo para usar otro proveedor sin redeploy (p.ej. Gmail: smtp.gmail.com).",
    category:    "email",
  },
  {
    key:         "SMTP_PORT",
    type:        "number",
    default:     465,
    label:       "SMTP · Puerto",
    description: "465 = TLS implícito (recomendado). 587 / 2587 = STARTTLS. El mailer activa 'secure' automáticamente cuando el puerto es 465.",
    category:    "email",
  },
  {
    key:         "SMTP_USER",
    type:        "string",
    default:     "resend",
    label:       "SMTP · Usuario",
    description: "Usuario de autenticación SMTP. En Resend es literalmente 'resend' (la API key hace de contraseña). En Gmail sería tu dirección completa.",
    category:    "email",
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

/**
 * ¿Están las preguntas PRO accesibles públicamente por URL individual?
 *
 * - true  → /preguntas/[cat]/[slug] sirve cualquier pregunta (FREE+PRO)
 *           y el sitemap.xml las incluye todas (~2.500 URLs).
 * - false → solo las ~210 FREE de permiso-b se sirven públicamente;
 *           el resto devuelve 404 y no aparece en sitemap.
 *
 * El índice /preguntas y las "preguntas relacionadas" SIEMPRE muestran
 * solo FREE — el flag solo controla acceso directo por URL y sitemap.
 */
export async function isSeoExposeProQuestions(): Promise<boolean> {
  return getConfig("SEO_EXPOSE_PRO_QUESTIONS", false)
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

/** Modelo de Llama que usa Groq. Solo aplica si AI_PROVIDER='groq'. */
export async function getGroqModel(): Promise<string> {
  const entry = CONFIG_CATALOG.find((c) => c.key === "GROQ_MODEL")!
  return getConfig("GROQ_MODEL", entry.default as string)
}

export type AIProviderName = "gemini" | "groq"

/**
 * Proveedor de IA activo. Default 'gemini'. Si en BBDD hay un valor
 * inválido (alguien metió 'azure' por ejemplo), caemos al default
 * 'gemini' para que la app siga funcionando.
 */
export async function getAIProvider(): Promise<AIProviderName> {
  const value = await getConfig("AI_PROVIDER", "gemini")
  return value === "groq" ? "groq" : "gemini"
}

// ── Email / SMTP ────────────────────────────────────────────────────
// Prioridad de cada valor: BBDD (/admin) → env var del mismo nombre →
// hardcoded (Resend). El mailer (src/lib/mailer.ts) envuelve estas
// llamadas en try/catch: si la BBDD está caída, cae al default sin
// lanzar (el mailer se usa fire-and-forget en webhooks).

export async function getMailFrom(): Promise<string> {
  return getConfig("MAIL_FROM", process.env.MAIL_FROM ?? "DGT-TESTS <noreply@hdglabs.com>")
}

export async function getSmtpHost(): Promise<string> {
  return getConfig("SMTP_HOST", process.env.SMTP_HOST ?? "smtp.resend.com")
}

export async function getSmtpPort(): Promise<number> {
  const envPort = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined
  return getConfig("SMTP_PORT", envPort && Number.isFinite(envPort) ? envPort : 465)
}

export async function getSmtpUser(): Promise<string> {
  return getConfig("SMTP_USER", process.env.SMTP_USER ?? "resend")
}
