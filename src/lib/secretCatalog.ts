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
    providerUrl:  "https://luishidalgoa.sentry.io/projects/",
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
    description:  "Slug del proyecto en Sentry (en tu caso: 'dgt-tests'). Igual que ORG, se usa al build para subir source maps.",
    formatHint:   "dgt-tests",
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

  // ── Cloudflare R2 · CDN de imágenes + storage server-side ───────────
  // 6 entries en un grupo único. Las 2.646 PNG de preguntas DGT viven
  // en este bucket (público en LECTURA via la URL CDN). Las creds
  // access_key + secret se usan para ESCRIBIR (upload de imágenes
  // generadas por IA en el futuro, scripts de re-upload, etc.).
  //
  // El botón "Probar conexión" se renderiza en la card de R2_SECRET_ACCESS_KEY
  // (página /admin/secrets). Hace HeadBucket + ListObjects para verificar
  // que las 5 vars son consistentes entre sí.
  {
    key:          "NEXT_PUBLIC_IMAGE_CDN_URL",
    label:        "R2 · URL pública del CDN",
    description:  "URL base del bucket público para servir las PNG de preguntas. NO es un secreto — sale en el HTML del cliente. El runtime client+server lo lee con imageUrl(). En producción ponlo TAMBIÉN como NEXT_PUBLIC_IMAGE_CDN_URL en Vercel env vars para que se bakedee al build del cliente.",
    formatHint:   "https://pub-xxxxxxxx.r2.dev",
    providerUrl:  "https://dash.cloudflare.com/?to=/:account/r2",
    group:        "Cloudflare R2",
    scope:        "client-build",
  },
  {
    key:          "R2_ACCOUNT_ID",
    label:        "R2 · Account ID",
    description:  "ID de la cuenta de Cloudflare. Aparece en la URL del dashboard y se usa para construir el endpoint S3.",
    formatHint:   "32 caracteres hex",
    providerUrl:  "https://dash.cloudflare.com",
    group:        "Cloudflare R2",
  },
  {
    key:          "R2_BUCKET_NAME",
    label:        "R2 · Bucket name",
    description:  "Nombre del bucket donde viven las imágenes.",
    formatHint:   "dgt-tests-images",
    providerUrl:  "https://dash.cloudflare.com/?to=/:account/r2",
    group:        "Cloudflare R2",
  },
  {
    key:          "R2_ENDPOINT",
    label:        "R2 · S3 endpoint",
    description:  "URL del endpoint compatible con S3 que apunta a tu cuenta de R2.",
    formatHint:   "https://<account_id>.r2.cloudflarestorage.com",
    providerUrl:  "https://dash.cloudflare.com/?to=/:account/r2",
    group:        "Cloudflare R2",
  },
  {
    key:          "R2_ACCESS_KEY_ID",
    label:        "R2 · Access Key ID",
    description:  "Identificador de las credenciales R2. NO es secreto técnicamente, pero lo agrupamos aquí. Lo emite el dashboard de R2 → Manage API Tokens al crear un token 'Object Read & Write' con scope a tu bucket.",
    formatHint:   "32 caracteres hex",
    providerUrl:  "https://dash.cloudflare.com/?to=/:account/r2/api-tokens",
    group:        "Cloudflare R2",
  },
  {
    key:          "R2_SECRET_ACCESS_KEY",
    label:        "R2 · Secret Access Key",
    description:  "Clave secreta para firmar las peticiones S3 contra R2. SECRETO. Si la pierdes hay que generar un nuevo token desde el dashboard de R2 (el secret solo se muestra una vez al crear el token).",
    formatHint:   "64 caracteres hex",
    providerUrl:  "https://dash.cloudflare.com/?to=/:account/r2/api-tokens",
    group:        "Cloudflare R2",
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
