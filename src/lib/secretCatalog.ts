/**
 * Catálogo de SECRETOS gestionables desde /admin/secrets.
 *
 * Diferencias respecto a configCatalog:
 *   - Su `value` se guarda cifrado en AppConfig (encrypted=true).
 *   - El UI no muestra el valor — solo "configurado / no configurado"
 *     y un mask de los primeros caracteres.
 *   - Para LEER el valor efectivo desde el runtime usa getEffectiveSecret(),
 *     que prefiere la DB y cae al env var del mismo nombre.
 *
 * El catálogo define metadata: descripción, hint del formato esperado
 * y opcionalmente cómo "probar" la conexión (fase posterior).
 */
import { db } from "@/lib/db"
import { decryptSecret } from "@/lib/crypto"

export interface SecretEntry {
  key:          string
  label:        string
  description:  string
  /** Hint del formato esperado, p.ej. "sk_live_..." */
  formatHint?:  string
  /** Pista del proveedor para enlazar al dashboard. */
  providerUrl?: string
  /**
   * Si este secret es la API key de un proveedor de IA, su identificador.
   * El panel renderiza un botón "Probar conexión" debajo del form para
   * hacer un health check en vivo con la key + modelo configurados.
   */
  aiProvider?:  "gemini" | "groq"
  /**
   * Si se define, esta entry se agrupa con otras del mismo `group` en un
   * <details> colapsable en /admin/secrets. Útil para integrarciones con
   * varias variables (Sentry: DSN + org + project + auth_token).
   */
  group?:       string
  /**
   * "build" → solo se usa al `next build` (subir source maps, etc.).
   *           Si lo guardas en /admin, el runtime NO lo lee — sirve como
   *           registro centralizado para que también lo pongas en
   *           Vercel env vars.
   * "runtime" → el server lo lee en cada request (vía getEffectiveSecret).
   * "client-build" → se baked en el bundle del cliente al build.
   *           Igual que "build", el admin sirve como registro.
   * Default (undefined): runtime.
   */
  scope?:       "build" | "runtime" | "client-build"
}

export const SECRET_CATALOG: SecretEntry[] = [
  {
    key:          "STRIPE_SECRET_KEY",
    label:        "Stripe · Secret key",
    description:  "Clave secreta para crear sesiones de Checkout, gestionar suscripciones, etc.",
    formatHint:   "sk_live_... (LIVE) o sk_test_... / rk_live_... (Restricted)",
    providerUrl:  "https://dashboard.stripe.com/apikeys",
    group:        "Stripe",
  },
  {
    key:          "STRIPE_WEBHOOK_SECRET",
    label:        "Stripe · Webhook signing secret",
    description:  "Para validar la firma de los webhooks que Stripe envía a /api/webhooks/stripe.",
    formatHint:   "whsec_...",
    providerUrl:  "https://dashboard.stripe.com/webhooks",
    group:        "Stripe",
  },
  {
    key:          "GEMINI_API_KEY",
    label:        "Gemini API key",
    description:  "Para el chatbot IA que explica las preguntas del test (cuando AI_PROVIDER=gemini).",
    formatHint:   "AIza...",
    providerUrl:  "https://aistudio.google.com/apikey",
    aiProvider:   "gemini",
    group:        "IA",
  },
  {
    key:          "GROQ_API_KEY",
    label:        "Groq API key",
    description:  "Proveedor IA alternativo basado en Llama (cuando AI_PROVIDER=groq). Más throughput, latencia menor.",
    formatHint:   "gsk_...",
    providerUrl:  "https://console.groq.com/keys",
    aiProvider:   "groq",
    group:        "IA",
  },
  {
    key:          "GMAIL_APP_PASSWORD",
    label:        "Gmail · App password",
    description:  "Contraseña de aplicación (16 chars) para enviar emails vía SMTP de Gmail.",
    formatHint:   "xxxx xxxx xxxx xxxx (con o sin espacios)",
    providerUrl:  "https://myaccount.google.com/apppasswords",
  },

  // ── Sentry · Monitoreo de errores ────────────────────────────────────
  // Grupo colapsable en /admin/secrets. El server lee el DSN runtime
  // (sentry.server.config.ts). ORG/PROJECT/AUTH_TOKEN se usan al build
  // (next.config.ts) — la app los lee de la DB si los pones aquí, o
  // del env var como fallback.
  {
    key:          "NEXT_PUBLIC_SENTRY_DSN",
    label:        "Sentry · DSN",
    description:  "URL de ingest del proyecto. El server lo lee desde aquí en cada request (vía getEffectiveSecret). NOTA: el cliente lo necesita baked al build → también ponlo como NEXT_PUBLIC_SENTRY_DSN en Vercel env vars.",
    formatHint:   "https://<key>@<org-id>.ingest.<region>.sentry.io/<project-id>",
    providerUrl:  "https://luishidalgoa.sentry.io/projects/javascript-nextjs/getting-started/",
    group:        "Sentry",
    scope:        "runtime",
  },
  {
    key:          "SENTRY_ORG",
    label:        "Sentry · Org slug",
    description:  "Slug de la organización en Sentry. Se usa al `next build` para subir source maps. Si lo guardas aquí + tienes DATABASE_URL durante el build, withSentryConfig lo lee de la DB; si no, cae al env var.",
    formatHint:   "luishidalgoa",
    providerUrl:  "https://luishidalgoa.sentry.io/settings/organization/",
    group:        "Sentry",
    scope:        "build",
  },
  {
    key:          "SENTRY_PROJECT",
    label:        "Sentry · Project slug",
    description:  "Slug del proyecto en Sentry. Igual que ORG, se usa al build para subir source maps.",
    formatHint:   "javascript-nextjs",
    providerUrl:  "https://luishidalgoa.sentry.io/projects/",
    group:        "Sentry",
    scope:        "build",
  },
  {
    key:          "SENTRY_AUTH_TOKEN",
    label:        "Sentry · Auth token",
    description:  "Token con scopes project:releases + project:read. SECRETO. Se usa al build para subir source maps. Generar en Sentry → Settings → Auth Tokens → Create token.",
    formatHint:   "sntrys_... o sntryu_...",
    providerUrl:  "https://luishidalgoa.sentry.io/settings/account/api/auth-tokens/",
    group:        "Sentry",
    scope:        "build",
  },
]

/**
 * Mask para mostrar un secret de forma segura en UI: primeros 8 chars
 * + bullets. Nunca devuelve el valor entero.
 */
export function maskSecret(value: string): string {
  if (!value || value.length < 6) return "••••"
  const visible = value.slice(0, 8)
  return `${visible}${"•".repeat(8)}`
}

/**
 * Devuelve el valor efectivo del secret para uso en runtime.
 *
 * Prioridad:
 *   1. AppConfig (encrypted=true) si existe y se descifra OK
 *   2. process.env[key] como fallback
 *   3. null si ninguno
 *
 * Nunca lanza — si el envelope cifrado está corrupto o falla la key
 * maestra, devuelve el env (o null). Así el runtime sigue funcionando
 * aunque la BBDD esté en un estado raro.
 */
export async function getEffectiveSecret(key: string): Promise<string | null> {
  // Intentamos primero la BBDD
  const row = await db.appConfig.findUnique({ where: { key } })
  if (row && row.encrypted) {
    try {
      return decryptSecret(row.value)
    } catch {
      // Cifrado corrupto / key cambiada / etc. Caemos a env.
    }
  }
  // Fallback al env var con el mismo nombre
  const fromEnv = process.env[key]
  return fromEnv && fromEnv.length > 0 ? fromEnv : null
}
