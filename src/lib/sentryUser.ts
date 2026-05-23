/**
 * Helpers para asociar contexto de USER + breadcrumbs a Sentry desde
 * código de aplicación. NO contiene PII sensible (email, IP, etc.) —
 * solo id y username, suficiente para correlacionar issues.
 *
 * Patrón de uso:
 *  - identifyUserInSentry: se llama desde getCurrentUser() (auth.ts) en
 *    cada request server-side; cualquier error capturado después tendrá
 *    al user adjunto en el dashboard de Sentry.
 *  - addBreadcrumb: pon uno antes de operaciones de riesgo (Stripe call,
 *    AI call, email send) — si algo peta luego, Sentry muestra el path.
 *
 * Si Sentry no está inicializado (DSN vacío en dev), estas funciones
 * son no-ops silenciosas (Sentry SDK lo gestiona internamente).
 */
import * as Sentry from "@sentry/nextjs"

export interface SentryUserContext {
  id:       number
  username: string
}

/**
 * Asocia el user actual al scope de Sentry. Llamar desde getCurrentUser
 * (server-side) en cada request — cada lambda tiene su propio scope, no
 * hay leakage entre usuarios.
 *
 * Pasar `null` para desasociar (logout, requests anónimos).
 */
export function identifyUserInSentry(user: SentryUserContext | null): void {
  if (user) {
    Sentry.setUser({
      id:       String(user.id),
      username: user.username,
      // NO: email, ip_address — son PII y los filtramos en sentryScrub.ts
    })
  } else {
    Sentry.setUser(null)
  }
}

/**
 * Añade un breadcrumb (evento de trazabilidad) al scope actual. Aparece
 * en Sentry como timeline antes del error, ayudando a reproducir.
 *
 * Niveles típicos:
 *  - "info":    flujo normal ("user logged in", "ai call started")
 *  - "warning": algo raro pero no fatal ("rate limit hit, retry queued")
 *  - "error":   algo falló pero ya gestionado
 *
 * @example
 *   addAppBreadcrumb({ category: "ai", message: "explainQuestion called",
 *                      data: { provider: "gemini", model: "flash" } })
 */
export function addAppBreadcrumb(opts: {
  category: "auth" | "ai" | "stripe" | "email" | "party" | "exam"
  message:  string
  level?:   "info" | "warning" | "error"
  data?:    Record<string, unknown>
}): void {
  Sentry.addBreadcrumb({
    category: opts.category,
    message:  opts.message,
    level:    opts.level ?? "info",
    data:     opts.data,
  })
}

/**
 * Captura una excepción manualmente con tags estructurados. Útil cuando
 * envuelves un try/catch que tragas (no quieres propagar pero sí
 * registrar). Si propagas el error, NO necesitas esto — el captureRequestError
 * de instrumentation.ts ya lo recoge.
 *
 * @example
 *   try { await stripe.charge(...) }
 *   catch (err) {
 *     captureAppException(err, {
 *       category: "stripe",
 *       tags: { operation: "checkout", priceId: "price_xxx" },
 *     })
 *     return { ok: false }
 *   }
 */
export function captureAppException(
  error: unknown,
  opts: {
    category: "auth" | "ai" | "stripe" | "email" | "party" | "exam"
    tags?:    Record<string, string>
    extra?:   Record<string, unknown>
  },
): string {
  return Sentry.captureException(error, {
    tags: {
      "app.category": opts.category,
      ...opts.tags,
    },
    extra: opts.extra,
  })
}
