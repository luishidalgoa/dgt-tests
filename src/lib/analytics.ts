/**
 * Wrapper provider-agnostic para tracking de eventos en cliente.
 *
 * Soporta Umami y Plausible (cookieless, GDPR-friendly). PostHog se podría
 * añadir aquí también si se quiere session replay/heatmaps en el futuro.
 *
 * Cómo configurar el provider (en Vercel env vars):
 *
 *   NEXT_PUBLIC_ANALYTICS_PROVIDER="umami"     // "umami" | "plausible"
 *   NEXT_PUBLIC_ANALYTICS_SCRIPT_URL="https://cloud.umami.is/script.js"
 *   NEXT_PUBLIC_ANALYTICS_WEBSITE_ID="<el-id-del-site>"
 *
 * Si NEXT_PUBLIC_ANALYTICS_WEBSITE_ID no está set, NADA se trackea —
 * el sitio funciona idéntico sin analytics. Útil para previews/local.
 *
 * GDPR / consentimiento:
 *   - Umami y Plausible son cookieless por diseño → no requieren consent
 *     banner en sí mismos.
 *   - Aún así respetamos `dgt:cookie-consent` del banner del proyecto: si
 *     el user eligió "essential only", no enviamos eventos (decisión
 *     conservadora — algunos usuarios entienden "essential" como "nada
 *     que me trackee").
 *
 * Eventos del proyecto (catálogo central):
 *   - signup_complete             — user completó /register
 *   - subscription_started        — Stripe checkout completado
 *   - subscription_canceled       — user inició cancelación
 *   - test_completed              — terminó un examen (mode, scorePct)
 *   - ai_analysis_generated       — pagó tokens IA por análisis
 *   - personalized_test_started   — lanzó test personalizado
 *   - errors_test_started         — abrió /test-errores
 */

/** Catálogo central de eventos. Tipado fuerte para no escribir 'sigup_complete' por error. */
export type AnalyticsEvent =
  | "signup_complete"
  | "subscription_started"
  | "subscription_canceled"
  | "test_completed"
  | "ai_analysis_generated"
  | "personalized_test_started"
  | "errors_test_started"

/** Props serializables. Sin PII: no usernames, emails, etc. Solo agregados. */
export type AnalyticsProps = Record<string, string | number | boolean>

interface UmamiGlobal {
  track: (name: string, props?: AnalyticsProps) => void
}

interface PlausibleGlobal {
  (eventName: string, options?: { props?: AnalyticsProps }): void
}

// Window globals que cada provider inyecta al cargar su script.
declare global {
  interface Window {
    umami?:     UmamiGlobal
    plausible?: PlausibleGlobal
  }
}

const CONSENT_KEY = "dgt:cookie-consent"

/** Lee el consent del banner. true = OK trackear; false = el user rechazó. */
function consentAllowsAnalytics(): boolean {
  if (typeof window === "undefined") return false
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY)
    if (!raw) return false  // no decidido aún → no trackear
    const parsed = JSON.parse(raw) as { accepted?: string }
    return parsed.accepted === "all"
  } catch {
    return false
  }
}

/**
 * Dispara un evento al provider configurado. No-op si:
 *  - Se llama server-side
 *  - El user no aceptó cookies "all"
 *  - El script del provider aún no se cargó (race con el primer evento)
 *
 * No throwea nunca — analytics es soft, no debe romper la UX.
 */
export function trackEvent(name: AnalyticsEvent, props?: AnalyticsProps): void {
  if (typeof window === "undefined") return
  if (!consentAllowsAnalytics()) return

  try {
    // Umami: window.umami.track(name, props)
    if (window.umami) {
      window.umami.track(name, props)
      return
    }
    // Plausible: window.plausible(name, { props })
    if (window.plausible) {
      window.plausible(name, props ? { props } : undefined)
      return
    }
    // Si ningún provider está cargado, no hacemos nada (race en first render).
  } catch {
    // Silenciar errores de provider para no afectar UX.
  }
}
