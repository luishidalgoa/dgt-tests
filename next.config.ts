import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Permite acceder al dev server desde el móvil por IP de LAN. Sin esto,
  // Next 15+ bloquea /_next/webpack-hmr → HMR no engancha → React no
  // hidrata → el submit del form cae al handler nativo (recarga la página)
  // y el :active del botón eye se queda pegado.
  allowedDevOrigins: ["192.168.0.19"],

  /**
   * Redirects 301 permanentes.
   *
   * /sobre → /sobre-mi  (renombrado el 2026-05-22; mantenemos el redirect
   * porque la URL antigua puede estar enlazada desde notificaciones,
   * histórico del navegador o indexada por buscadores).
   */
  async redirects() {
    return [
      {
        source:      "/sobre",
        destination: "/sobre-mi",
        permanent:   true,
      },
    ]
  },
};

// Async export — Next soporta `module.exports = async () => ({...})` para
// poder leer config asíncrona al build (en nuestro caso, los slugs de
// Sentry desde AppConfig en BBDD con fallback al env). Si DATABASE_URL no
// está disponible al build (caso muy raro), cae limpiamente a env vars.
export default async (): Promise<NextConfig> => {
  // Import dinámico para evitar cargar prisma + dependencies cuando Next
  // hace dry-runs del config (p.ej. listar rutas) — solo lo necesitamos
  // en el build real.
  let sentryOrg       = process.env.SENTRY_ORG
  let sentryProject   = process.env.SENTRY_PROJECT
  let sentryAuthToken = process.env.SENTRY_AUTH_TOKEN

  try {
    const { getEffectiveSecret } = await import("./src/lib/secretCatalog")
    sentryOrg       = (await getEffectiveSecret("SENTRY_ORG"))        ?? sentryOrg
    sentryProject   = (await getEffectiveSecret("SENTRY_PROJECT"))    ?? sentryProject
    sentryAuthToken = (await getEffectiveSecret("SENTRY_AUTH_TOKEN")) ?? sentryAuthToken
  } catch {
    // DB no disponible (sin DATABASE_URL, build en entorno limpio, etc.)
    // Caemos a env vars y seguimos. Si tampoco hay env vars, Sentry
    // skipea la subida de source maps con un warning.
  }

  return withSentryConfig(nextConfig, {
    org:           sentryOrg,
    project:       sentryProject,
    authToken:     sentryAuthToken,
    // Silencia los logs del plugin a menos que estemos en CI.
    silent:        !process.env.CI,
    // Sube los source maps de TODOS los chunks client (no solo los del
    // app router). Útil para que stacktraces de viejos chunks resuelvan.
    widenClientFileUpload: true,
    // No incluyas los source maps en el bundle servido al cliente — solo
    // los sube a Sentry. Mejora privacidad + bundle size.
    sourcemaps:    { disable: false },
    // Desactiva el logger interno de Sentry (los console.log del SDK
    // ensucian la consola del navegador en prod).
    disableLogger: true,
    // Auto-instrumenta @vercel/otel si está. No nos afecta hoy pero
    // es la recomendación oficial.
    automaticVercelMonitors: true,
  })
}
