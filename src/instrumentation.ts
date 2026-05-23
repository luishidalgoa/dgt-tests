/**
 * Next.js instrumentation hook — corre antes de levantar el server.
 *
 * Carga el config de Sentry apropiado según el runtime (Node.js para
 * lambdas / API routes, Edge para middleware). Sin esto Sentry no se
 * inicializa en server-side.
 *
 * Ver: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Los configs de Sentry van en la raíz por convención del SDK (el
    // plugin del build los detecta ahí). instrumentation.ts vive en
    // src/ por convención de Next cuando hay src/, igual que
    // src/middleware.ts — de ahí el ../ relativo.
    await import("../sentry.server.config")
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config")
  }
}

// Hook para que errores no-handled de React Server Components lleguen
// a Sentry — opcional pero recomendado.
export { captureRequestError as onRequestError } from "@sentry/nextjs"
