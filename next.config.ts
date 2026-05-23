import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Permite acceder al dev server desde el móvil por IP de LAN. Sin esto,
  // Next 15+ bloquea /_next/webpack-hmr → HMR no engancha → React no
  // hidrata → el submit del form cae al handler nativo (recarga la página)
  // y el :active del botón eye se queda pegado.
  allowedDevOrigins: ["192.168.0.19"],

  /**
   * serverExternalPackages: deps pesadas que NO queremos bundleadas en cada
   * lambda — Next las trata como `require()` runtime, las carga desde
   * node_modules en Vercel. Reduce drásticamente el tamaño del lambda
   * unzipped (límite Vercel = 250MB).
   *
   * Por qué cada una:
   *  - @prisma/client      ~60MB con engine binary, cada API route lo usa
   *  - pdfjs-dist          ~30MB, sólo client (FlipbookViewer) pero el trace
   *                        lo arrastraba a algunos lambdas por imports
   *                        transitivos vía types
   *  - react-pdf           ~10MB, mismo motivo que pdfjs-dist
   *  - react-pageflip      ~5MB, idem
   *  - sharp               nativo grande si lo añadimos en futuro
   *  - nodemailer          ~5MB, solo se usa en mailer.ts (no en cada lambda)
   *
   * @sentry/nextjs NO lo metemos aquí — su SDK necesita ser bundleado para
   * que su instrumentación auto-mágica funcione (recomendación oficial).
   */
  serverExternalPackages: [
    "@prisma/client",
    "pdfjs-dist",
    "react-pdf",
    "react-pageflip",
    "nodemailer",
  ],

  /**
   * outputFileTracingExcludes: archivos que el trace de Next "arrastra" al
   * lambda sin ser necesarios runtime. Cada glob ahorra unos MB.
   */
  outputFileTracingExcludes: {
    "*": [
      // Source maps no se usan en runtime (Sentry ya los tiene tras upload)
      "**/*.map",
      // Cache de Next build, NO debe ir al lambda
      ".next/cache/**",
      // Duplicación common: Sentry trae cjs + esm, con uno basta runtime
      "node_modules/@sentry/profiling-node/**",
      "node_modules/@sentry-internal/browser-utils/**",
      // PDF libs si por algún edge case el trace las arrastró
      "node_modules/pdfjs-dist/**",
      "node_modules/react-pdf/**",
      "node_modules/react-pageflip/**",
      // Locale data de moment/date-fns (no usamos)
      "node_modules/moment/locale/**",
      // Prisma engines de plataformas que NO son Vercel (Linux x64)
      "node_modules/@prisma/engines/*windows*",
      "node_modules/@prisma/engines/*darwin*",
      "node_modules/.prisma/client/*windows*",
      "node_modules/.prisma/client/*darwin*",
    ],
  },

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
    // Auto-instrumenta @vercel/otel si está. Movido a webpack.* en el
    // SDK reciente (el flag top-level emite DEPRECATION WARNING al boot).
    webpack: { automaticVercelMonitors: true },
  })
}
