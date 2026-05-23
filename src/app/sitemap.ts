import type { MetadataRoute } from "next"
import { db } from "@/lib/db"
import { FREE_CATEGORY_SLUG, FREE_TEST_LIMIT } from "@/lib/permissions"
import { RECURSOS } from "@/content/recursos/_registry"
import { questionToSlug } from "@/lib/questionUrl"
import { isSeoExposeProQuestions } from "@/lib/configCatalog"
import { QUESTION_VISIBLE_WHERE } from "@/lib/questions"

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
      // FAQ con FAQPage schema → potencial alto en long-tail queries
      // tipo "cuántos fallos puedo tener" / "cuánto cuesta el carné".
      url:           `${APP_URL}/faq`,
      lastModified:  today,
      changeFrequency: "monthly",
      priority:      0.7,
    },
    {
      // Índice de guías largas — bisagra hacia los artículos pilares.
      url:           `${APP_URL}/recursos`,
      lastModified:  today,
      changeFrequency: "weekly",
      priority:      0.7,
    },
    {
      // Índice de preguntas individuales — bisagra hacia las ~210
      // URLs SEO long-tail de las preguntas FREE.
      url:           `${APP_URL}/preguntas`,
      lastModified:  today,
      changeFrequency: "weekly",
      priority:      0.7,
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

  // ── Artículos de /recursos ─────────────────────────────────────────
  // Cada artículo tiene priority alta (0.7) porque son content pages
  // con potencial real de rankear long-tail. lastModified usa la fecha
  // de la última edición del artículo concreto.
  const recursoRoutes: MetadataRoute.Sitemap = RECURSOS.map((r) => ({
    url:             `${APP_URL}/recursos/${r.meta.slug}`,
    lastModified:    new Date(r.meta.updatedAt),
    changeFrequency: "monthly" as const,
    priority:        0.7,
  }))

  // ── Preguntas individuales ────────────────────────────────────────
  // El número de URLs depende del toggle SEO_EXPOSE_PRO_QUESTIONS:
  //   - OFF (default): solo las ~210 FREE de permiso-b.
  //   - ON: TODAS las preguntas (FREE + PRO de cualquier categoría),
  //         ~2.500 URLs. Cada una candidata a rankear por su query
  //         textual long-tail.
  //
  // Priority 0.5: importantes pero no más que las pilares y home.
  // changeFrequency yearly: las preguntas DGT no se editan casi nunca.
  //
  // Defensivo: si falla la query, sitemap sigue funcionando sin
  // las preguntas (no rompemos el sitemap entero por un timeout).
  let questionRoutes: MetadataRoute.Sitemap = []
  try {
    const exposePro = await isSeoExposeProQuestions()
    const questions = await db.question.findMany({
      where: exposePro
        ? {
            // ON: cualquier pregunta visible (cualquier tier, cualquier
            // categoría), aprobada por review IA (o humana original).
            ...QUESTION_VISIBLE_WHERE,
          }
        : {
            // OFF: solo FREE de permiso-b.
            tier: "FREE",
            testQuestions: {
              some: { test: { category: { slug: FREE_CATEGORY_SLUG } } },
            },
            ...QUESTION_VISIBLE_WHERE,
          },
      select: {
        id:        true,
        enunciado: true,
        // Necesitamos la categoría real (vía testQuestions) cuando el
        // toggle está ON para construir URLs como /preguntas/adas/X
        // o /preguntas/repaso-final/X — no todas son permiso-b.
        testQuestions: {
          take: 1,
          orderBy: { test: { testNumber: "asc" } },
          select: { test: { select: { category: { select: { slug: true } } } } },
        },
      },
    })
    questionRoutes = questions.flatMap((q) => {
      const catSlug = q.testQuestions[0]?.test.category.slug ?? FREE_CATEGORY_SLUG
      return [{
        url:             `${APP_URL}/preguntas/${catSlug}/${questionToSlug(q)}`,
        lastModified:    today,
        changeFrequency: "yearly" as const,
        priority:        0.5,
      }]
    })
  } catch (err) {
    console.warn("[sitemap] no pude cargar preguntas individuales:", err)
  }

  return [
    ...staticRoutes,
    ...categoryRoutes,
    ...testRoutes,
    ...recursoRoutes,
    ...questionRoutes,
  ]
}
