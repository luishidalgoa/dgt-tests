/**
 * Detectores de entorno y modo Stripe para mostrar en /admin.
 *
 * Tratamos de no asumir nada que sea hard-coded ("este proyecto está en
 * Vercel y los .env son…"). Leemos lo que hay y lo describimos.
 */

export type RuntimeEnv =
  | "vercel-production"
  | "vercel-preview"
  | "vercel-development"
  | "vercel-unknown"   // Vercel set, pero sin VERCEL_ENV claro
  | "local-dev"        // No Vercel — máquina local

export interface RuntimeEnvInfo {
  env:       RuntimeEnv
  isVercel:  boolean
  isLocal:   boolean
  /** Texto descriptivo para mostrar en UI. */
  label:     string
}

export function detectRuntimeEnv(): RuntimeEnvInfo {
  // Vercel inyecta VERCEL=1 en su runtime. VERCEL_ENV es "production",
  // "preview" o "development" según el deployment.
  // Docs: https://vercel.com/docs/projects/environment-variables/system-environment-variables
  const isVercel = process.env.VERCEL === "1"
  const vercelEnv = process.env.VERCEL_ENV  // "production" | "preview" | "development" | undefined

  if (isVercel) {
    if (vercelEnv === "production") {
      return {
        env: "vercel-production",
        isVercel: true,
        isLocal:  false,
        label:    "Vercel · Production (Environment Variables del proyecto)",
      }
    }
    if (vercelEnv === "preview") {
      return {
        env: "vercel-preview",
        isVercel: true,
        isLocal:  false,
        label:    "Vercel · Preview (env vars de Preview)",
      }
    }
    if (vercelEnv === "development") {
      return {
        env: "vercel-development",
        isVercel: true,
        isLocal:  false,
        label:    "Vercel · Development (env vars de Development)",
      }
    }
    return {
      env: "vercel-unknown",
      isVercel: true,
      isLocal:  false,
      label:    "Vercel (entorno no identificado)",
    }
  }

  // No Vercel → asumimos máquina local con npm run dev / npm test / scripts
  return {
    env: "local-dev",
    isVercel: false,
    isLocal:  true,
    label:    "Local — leyendo .env + .env.local (override)",
  }
}

// ── Stripe mode (basado en el prefijo del secret) ───────────────────

export type StripeMode = "live" | "test" | "unknown"

/**
 * Stripe distingue claves por prefijo:
 *   sk_live_…, rk_live_…, pk_live_…, price_live_…, prod_live_… → LIVE
 *   sk_test_…, rk_test_…, pk_test_…, price_test_…              → TEST
 *   whsec_… NO indica modo (puede ser de cualquiera)
 */
export function detectStripeMode(value: string | null | undefined): StripeMode {
  if (!value) return "unknown"
  if (/_live_/.test(value)) return "live"
  if (/_test_/.test(value)) return "test"
  return "unknown"
}
