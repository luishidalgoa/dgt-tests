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
}

export const SECRET_CATALOG: SecretEntry[] = [
  {
    key:          "STRIPE_SECRET_KEY",
    label:        "Stripe · Secret key",
    description:  "Clave secreta para crear sesiones de Checkout, gestionar suscripciones, etc.",
    formatHint:   "sk_live_... (LIVE) o sk_test_... / rk_live_... (Restricted)",
    providerUrl:  "https://dashboard.stripe.com/apikeys",
  },
  {
    key:          "STRIPE_WEBHOOK_SECRET",
    label:        "Stripe · Webhook signing secret",
    description:  "Para validar la firma de los webhooks que Stripe envía a /api/webhooks/stripe.",
    formatHint:   "whsec_...",
    providerUrl:  "https://dashboard.stripe.com/webhooks",
  },
  {
    key:          "GEMINI_API_KEY",
    label:        "Gemini API key",
    description:  "Para el chatbot IA que explica las preguntas del test.",
    formatHint:   "AIza...",
    providerUrl:  "https://aistudio.google.com/apikey",
  },
  {
    key:          "GMAIL_APP_PASSWORD",
    label:        "Gmail · App password",
    description:  "Contraseña de aplicación (16 chars) para enviar emails vía SMTP de Gmail.",
    formatHint:   "xxxx xxxx xxxx xxxx (con o sin espacios)",
    providerUrl:  "https://myaccount.google.com/apppasswords",
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
