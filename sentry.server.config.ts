/**
 * Sentry SERVER init — corre en cada lambda / nodo de Next.
 *
 * El DSN viene de getEffectiveSecret("NEXT_PUBLIC_SENTRY_DSN"):
 *   1. Lo lee de AppConfig (encrypted) si está configurado desde /admin/secrets
 *   2. Fallback a process.env.NEXT_PUBLIC_SENTRY_DSN si no hay row en DB
 *   3. Si ambos vacíos → no init (no-op silent)
 *
 * Init es async (fire-and-forget). En la práctica añade ~10ms al primer
 * request. Si un error ocurre durante esa ventana no se reportará — es
 * trade-off aceptable para permitir configuración via /admin sin redeploy.
 *
 * Kill switch: vacía la entrada NEXT_PUBLIC_SENTRY_DSN en /admin/secrets
 * y borra (o pon vacío) el env var fallback. Los nuevos requests dejarán
 * de reportar después del próximo cold-start del lambda.
 */
import * as Sentry from "@sentry/nextjs"
import { scrubPII } from "@/lib/sentryScrub"
import { getEffectiveSecret } from "@/lib/secretCatalog"

const ENV = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development"

void (async () => {
  const dsn = await getEffectiveSecret("NEXT_PUBLIC_SENTRY_DSN")
  if (!dsn) return

  Sentry.init({
    dsn,
    environment:      ENV,
    tracesSampleRate: ENV === "production" ? 0.1 : 1.0,
    beforeSend:       scrubPII,
    // Errores que NO queremos reportar (flujo esperado de Next.js):
    //   NEXT_NOT_FOUND, NEXT_REDIRECT son señales internas que se tiran
    //   como excepciones pero son control flow normal.
    ignoreErrors: [
      "NEXT_NOT_FOUND",
      "NEXT_REDIRECT",
      "NEXT_HTTP_ERROR_FALLBACK",
    ],
  })
})()
