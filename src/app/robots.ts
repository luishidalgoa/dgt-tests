import type { MetadataRoute } from "next"

/**
 * /robots.txt — Next.js lo genera de este export al build.
 *
 * Política:
 *  - Allow `/` (todo lo público es indexable por defecto)
 *  - Disallow rutas autenticadas (no aportan SEO + pueden tener datos
 *    user-specific que no queremos en SERPs)
 *  - Apuntamos al sitemap.xml para que Google lo descubra solo
 *
 * /admin/ y /api/ también están bloqueados defensivamente — el
 * middleware ya devuelve 404/redirect para non-admin, pero un crawler
 * que llegue por enlace en un foro perdería el tiempo indexando rutas
 * que devuelven 4xx.
 */
export default function robots(): MetadataRoute.Robots {
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://dgt-tests.hdglabs.com"
  return {
    rules: {
      userAgent: "*",
      allow:     ["/"],
      disallow: [
        "/admin/",
        "/api/",
        "/settings",
        "/historial",
        "/stats",
        "/competir",
        "/party/",
        "/test-errores",
        "/test-personalizado",
        "/temas/",
        // Routes que pueden quedar tras navegación pero no queremos indexar:
        "/preview-results",
      ],
    },
    sitemap: `${APP_URL}/sitemap.xml`,
    host:    APP_URL,
  }
}
