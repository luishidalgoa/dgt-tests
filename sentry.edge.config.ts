/**
 * Sentry EDGE init — corre en el middleware / runtimes edge de Vercel.
 *
 * Sin scrub PII complejo: en edge no tenemos acceso a BBDD ni gran
 * mayoría de APIs Node. Init mínimo. El middleware actual (src/middleware.ts)
 * solo hace auth-gate, así que rara vez verá errores. Pero si los hay,
 * queremos saberlo.
 */
import * as Sentry from "@sentry/nextjs"

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN
const ENV = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development"

if (DSN) {
  Sentry.init({
    dsn:              DSN,
    environment:      ENV,
    tracesSampleRate: ENV === "production" ? 0.1 : 1.0,
  })
}
