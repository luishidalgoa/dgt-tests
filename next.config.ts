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

// Wrap con Sentry para que durante `next build` se suban source maps
// automáticamente. Si SENTRY_ORG/PROJECT/AUTH_TOKEN están vacíos, el
// wrapper no falla — solo se salta la subida (caso dev sin setup).
export default withSentryConfig(nextConfig, {
  org:           process.env.SENTRY_ORG,
  project:       process.env.SENTRY_PROJECT,
  authToken:     process.env.SENTRY_AUTH_TOKEN,
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
});

