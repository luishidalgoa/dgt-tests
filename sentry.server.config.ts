/**
 * Sentry SERVER init — corre en cada lambda / nodo de Next.
 *
 * Kill switch admin: FEATURE_SENTRY (en /admin). La lectura es async via
 * DB, así que la cacheamos con TTL 30s en módulo. Los primeros 30s tras
 * arrancar el server siempre van como `true` (optimista — preferimos
 * reportar eventos de más que perderlos durante el warmup).
 */
import * as Sentry from "@sentry/nextjs"
import { scrubPII } from "@/lib/sentryScrub"

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN
const ENV = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development"

if (DSN) {
  Sentry.init({
    dsn:              DSN,
    environment:      ENV,
    tracesSampleRate: ENV === "production" ? 0.1 : 1.0,
    beforeSend:       wrapWithKillSwitch(scrubPII),
    // No queremos reportar 404s ni redirects normales — Next.js los lanza
    // como excepciones internas (NEXT_NOT_FOUND, NEXT_REDIRECT) pero son
    // flujo esperado, no errores reales.
    ignoreErrors: [
      "NEXT_NOT_FOUND",
      "NEXT_REDIRECT",
      "NEXT_HTTP_ERROR_FALLBACK",
    ],
  })
}

// ── Kill switch via /admin (FEATURE_SENTRY) ─────────────────────────────
//
// beforeSend es sync, pero getConfig es async. Solución: cacheamos el
// valor en módulo con TTL 30s. En el primer evento desde el arranque,
// disparamos un fetch async sin bloquear (default optimista = true).
// Si /admin pone FEATURE_SENTRY=false, los eventos dejarán de subir en
// ~30s sin redeploy.

let _enabled       = true
let _lastCheckAt   = 0
const REFRESH_MS   = 30_000

function refreshFlagIfStale(): void {
  const now = Date.now()
  if (now - _lastCheckAt < REFRESH_MS) return
  _lastCheckAt = now
  // No `await` — fire-and-forget para no bloquear beforeSend.
  // Import dinámico para evitar ciclos al cargar el config en build.
  import("@/lib/configCatalog")
    .then((m) => m.isFeatureSentryEnabled())
    .then((v) => { _enabled = v })
    .catch(() => { /* mantenemos último valor conocido si falla la BBDD */ })
}

function wrapWithKillSwitch(
  inner: (event: Sentry.ErrorEvent) => Sentry.ErrorEvent | null
): (event: Sentry.ErrorEvent) => Sentry.ErrorEvent | null {
  return (event) => {
    refreshFlagIfStale()
    if (!_enabled) return null
    return inner(event)
  }
}
