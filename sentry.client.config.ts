/**
 * Sentry CLIENT init — corre en cada bundle del browser.
 *
 * El DSN se inyecta al build vía NEXT_PUBLIC_SENTRY_DSN. Si no hay DSN
 * (dev local sin setup), no inicializamos — evita 401s ruidosos al
 * intentar enviar eventos a un endpoint vacío.
 *
 * Para apagar Sentry en client sin redeploy NO es posible — el config
 * va baked en el bundle. Si necesitas matar reporting urgente, vacía
 * NEXT_PUBLIC_SENTRY_DSN en Vercel y redeploy.
 */
import * as Sentry from "@sentry/nextjs"
import { scrubPII } from "@/lib/sentryScrub"

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN
const ENV = process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? "development"

if (DSN) {
  Sentry.init({
    dsn:                 DSN,
    environment:         ENV,
    // En prod, solo sampleamos el 10% de transacciones (perf). En dev,
    // todo, para ver lo que se envía.
    tracesSampleRate:    ENV === "production" ? 0.1 : 1.0,
    // Replay de sesión: opt-in. 0 sesiones por defecto (cuesta storage).
    replaysSessionSampleRate: 0,
    // Pero cuando HAY un error, sí queremos grabar la sesión completa.
    replaysOnErrorSampleRate: 1.0,
    beforeSend:          scrubPII,
    // Errores ruidosos que no aportan nada — filtros estándar de Next.js
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      "Non-Error promise rejection captured",
      // Hidratación causada por extensiones de Chrome del usuario (Dark
      // Reader, Smart Lock) — no es bug nuestro, no queremos alertas.
      /hydrat/i,
    ],
  })
}
