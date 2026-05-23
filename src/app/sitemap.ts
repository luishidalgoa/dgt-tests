import type { MetadataRoute } from "next"
import { db } from "@/lib/db"
import { FREE_CATEGORY_SLUG, FREE_TEST_LIMIT } from "@/lib/permissions"

/**
 * /sitemap.xml — Next.js lo genera de este export al build.
 *
 * Incluimos:
 *  - Rutas estáticas públicas con prioridad acorde a su relevancia SEO
 *  - Cada categoría (/[slug])
 *  - Los tests del catálogo FREE (Permiso B, 1..FREE_TEST_LIMIT) —
 *    SOLO los que un guest puede acceder. Los tests >FREE_TEST_LIMIT y
 *    de otras categorías requieren login → no indexables.
 *
 * lastModified: los estáticos van con today (Google ignora si no aporta
 * señal); las categorías y tests con su updatedAt real de BBDD para que
 * cuando edites una pregunta se re-crawlee.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://dgt-tests.vercel.app"
  const today   = new Date()

  // ── Estáticas ──────────────────────────────────────────────────────
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url:           `${APP_URL}/`,
      lastModified:  today,
      changeFrequency: "daily",
      priority:      1.0,
    },
    {
      url:           `${APP_URL}/login`,
      lastModified:  today,
      changeFrequency: "yearly",
      priority:      0.3,
    },
    {
      url:           `${APP_URL}/register`,
      lastModified:  today,
      changeFrequency: "yearly",
      priority:      0.5,  // mayor que login: aporta conversiones
    },
    {
      url:           `${APP_URL}/upgrade`,
      lastModified:  today,
      changeFrequency: "monthly",
      priority:      0.6,
    },
    {
      url:           `${APP_URL}/sobre-mi`,
      lastModified:  today,
      changeFrequency: "monthly",
      priority:      0.3,
    },
    {
      url:           `${APP_URL}/privacidad`,
      lastModified:  today,
      changeFrequency: "yearly",
      priority:      0.2,
    },
    {
      url:           `${APP_URL}/return-policy`,
      lastModified:  today,
      changeFrequency: "yearly",
      priority:      0.2,
    },
  ]

  // ── Categorías + tests FREE ────────────────────────────────────────
  // Defensivo: si la BBDD no responde, devolvemos solo las estáticas
  // (no queremos romper el build por un fallo transitorio).
  let categoryRoutes: MetadataRoute.Sitemap = []
  let testRoutes:     MetadataRoute.Sitemap = []
  try {
    // Nota: Category/Test no tienen updatedAt en el schema (catálogo estable
    // de DGT, rara vez se modifica). Usamos `today` para todas. Si en el
    // futuro añadimos timestamps al schema, sustituir por c.updatedAt aquí.
    const categories = await db.category.findMany({
      orderBy: { id: "asc" },
      select:  { slug: true },
    })
    categoryRoutes = categories.map((c) => ({
      url:           `${APP_URL}/${c.slug}`,
      lastModified:  today,
      changeFrequency: "weekly" as const,
      priority:      0.8,
    }))

    // Solo los tests FREE de la categoría FREE son accesibles a guests
    // → solo esos se indexan. El resto requiere login + son content-gated.
    const freeCategory = await db.category.findUnique({
      where:  { slug: FREE_CATEGORY_SLUG },
      select: { id: true },
    })
    if (freeCategory) {
      const tests = await db.test.findMany({
        where:   { categoryId: freeCategory.id, testNumber: { lte: FREE_TEST_LIMIT } },
        orderBy: { testNumber: "asc" },
        select:  { testNumber: true },
      })
      testRoutes = tests.map((t) => ({
        url:           `${APP_URL}/${FREE_CATEGORY_SLUG}/${t.testNumber}`,
        lastModified:  today,
        changeFrequency: "weekly" as const,
        priority:      0.7,
      }))
    }
  } catch (err) {
    // No bloquear el build por fallo de BBDD durante sitemap generation.
    console.warn("[sitemap] no pude cargar categorías/tests, devolviendo solo estáticas:", err)
  }

  return [...staticRoutes, ...categoryRoutes, ...testRoutes]
}
