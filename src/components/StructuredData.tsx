/**
 * JSON-LD structured data (Schema.org) para rich results en Google.
 *
 * Renderizamos en el home 4 schemas:
 *  - WebSite: identifica el sitio + define la search action (rich result
 *    "Sitelinks Searchbox" en SERPs).
 *  - Organization: identidad de la org responsable (logo, sameAs links
 *    a redes sociales, contacto).
 *  - WebApplication: la app como SaaS — habilita rich results de tipo
 *    "Software" con pricing visible directamente en las SERPs.
 *  - Course: el "curso" de tests DGT — Google muestra preview de cursos
 *    con instructor, duración, modalidad. Encaja perfectamente con un
 *    sitio de exámenes y diferencia de competidores que no lo declaran.
 *
 * Validar tras deploy:
 *   https://search.google.com/test/rich-results?url=https://dgt-tests.hdglabs.com
 *
 * Schemas server-rendered como <script type="application/ld+json"> en el
 * <head>. Sin JS necesario en cliente — Google los procesa al crawlear.
 */

interface StructuredDataProps {
  /** URL absoluta del sitio. Inyectada desde el caller para no leer env
   *  aquí (este componente es agnóstico de runtime). */
  appUrl: string
}

export function StructuredDataHome({ appUrl }: StructuredDataProps) {
  // Schema.org permite combinar varios @types en un array. Los enviamos
  // como <script> separados — más fácil de debug en DevTools, y si
  // uno tiene typo Google sigue parseando los otros.
  const websiteSchema = {
    "@context":    "https://schema.org",
    "@type":       "WebSite",
    name:          "DGT Tests",
    alternateName: "DGT Tests · Examen de conducir",
    url:           appUrl,
    inLanguage:    "es-ES",
    description:   "Tests del examen teórico del carné de conducir (DGT). Permiso B, ADAS, repaso final y test de errores.",
    publisher: {
      "@type": "Organization",
      name:    "DGT Tests",
      url:     appUrl,
    },
    // SearchAction → si Google lo respeta, sale el cajón de búsqueda
    // directamente en las SERPs de la marca. Apuntamos a /temas porque
    // es donde tiene más sentido buscar (no hay /search dedicado).
    // potentialAction comentado: la search en site no existe todavía
    // como ruta — añadirlo cuando exista /search?q=...
  }

  const organizationSchema = {
    "@context": "https://schema.org",
    "@type":    "Organization",
    name:       "DGT Tests",
    url:        appUrl,
    logo:       `${appUrl}/icon.svg`,
    description:"Plataforma online para practicar los tests del examen teórico del carné de conducir.",
    foundingDate: "2026",
    founder: {
      "@type": "Person",
      name:    "Luis Hidalgo",
      url:     "https://portfolio.hdglabs.com/",
    },
    // sameAs: links a redes oficiales. Vacío de momento; cuando tengas
    // Twitter/Instagram/LinkedIn oficial de DGT Tests, los añades aquí.
    sameAs: [
      "https://portfolio.hdglabs.com/",
    ],
  }

  // WebApplication: declara la naturaleza SaaS de la app. El offer va
  // con el precio del plan FREE (0€) para que sea sincero — Stripe ya
  // ofrece PRO desde Checkout, pero Google necesita un offer principal
  // y el free tier es lo que se le ofrece al primer visitante.
  const webAppSchema = {
    "@context":          "https://schema.org",
    "@type":             "WebApplication",
    name:                "DGT Tests",
    url:                 appUrl,
    description:         "Plataforma web para practicar los tests del examen teórico del carné de conducir (DGT). 7 tests gratis sin registro, modo examen, IA explicativa y modo competición multijugador.",
    applicationCategory: "EducationalApplication",
    operatingSystem:     "Web Browser",
    inLanguage:          "es-ES",
    offers: {
      "@type":         "Offer",
      price:           "0",
      priceCurrency:   "EUR",
      description:     "7 tests del Permiso B gratis sin necesidad de cuenta",
      availability:    "https://schema.org/InStock",
    },
    // Audiencia: futuros conductores (18+). En España la edad mínima
    // para el carné B es 18 años exactos.
    audience: {
      "@type":    "EducationalAudience",
      educationalRole: "student",
    },
  }

  // Course schema: encaja con el contenido (tests/exámenes prácticos)
  // y desbloquea rich result específico de cursos. provider apunta a
  // la Organization ya declarada, hasCourseInstance describe la
  // modalidad (online, self-paced, gratis).
  const courseSchema = {
    "@context":   "https://schema.org",
    "@type":      "Course",
    name:         "Preparación del examen teórico DGT — Permiso B",
    description:  "Curso autoformativo online para preparar el examen teórico del carné de conducir Permiso B. Incluye preguntas oficiales del banco DGT con explicaciones, modo examen real (30 preguntas / 30 minutos), test de errores y bloque específico ADAS.",
    url:          appUrl,
    inLanguage:   "es-ES",
    provider: {
      "@type": "Organization",
      name:    "DGT Tests",
      url:     appUrl,
    },
    educationalLevel:    "Beginner",
    teaches:             "Normativa de tráfico, señalización, conducción segura, mecánica básica y sistemas ADAS",
    // hasCourseInstance es obligatorio en Google para que el Course
    // genere rich result. Lo declaramos como sesión online autoformativa
    // (self-paced) y gratuita para acceso de prueba.
    hasCourseInstance: {
      "@type":          "CourseInstance",
      courseMode:       "online",
      // courseWorkload en formato ISO 8601 duration. PT30M = 30 min
      // por test, que es lo que dura cada sesión de examen real.
      courseWorkload:   "PT30M",
      inLanguage:       "es-ES",
      // Curso ofrecido en modalidad self-paced, sin fecha fija — usamos
      // un rango muy amplio para señalizar "disponible siempre".
      startDate:        "2026-01-01",
      endDate:          "2099-12-31",
      offers: {
        "@type":       "Offer",
        category:      "Free",
        price:         "0",
        priceCurrency: "EUR",
      },
    },
  }

  return (
    <>
      <script
        type="application/ld+json"
        // dangerouslySetInnerHTML para que el JSON no se escape en HTML.
        // Es JSON estático generado server-side, sin user input → safe.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webAppSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(courseSchema) }}
      />
    </>
  )
}

/**
 * BreadcrumbList schema para páginas internas. Google lo usa para mostrar
 * la "miga de pan" debajo del título en SERPs:
 *
 *   dgt-tests.hdglabs.com › Permiso B › Test 3
 *
 * en vez de la URL cruda. Mejora CTR notablemente — la miga es más legible
 * que la URL y orienta al usuario sobre dónde aterriza al hacer click.
 *
 * Uso:
 *   <StructuredDataBreadcrumb items={[
 *     { name: "Inicio",    url: "/" },
 *     { name: "Permiso B", url: "/permiso-b" },
 *     { name: "Test 3",    url: "/permiso-b/3" },
 *   ]} appUrl={APP_URL} />
 *
 * Las URLs pueden ser relativas (empezando con "/") o absolutas — el
 * componente las normaliza a absolutas con appUrl.
 */
interface BreadcrumbItem {
  /** Texto visible (ej. "Permiso B", "Test 3") */
  name: string
  /** URL absoluta o relativa (ej. "/permiso-b/3") */
  url:  string
}

interface BreadcrumbProps {
  /** Lista ORDENADA de migas desde la raíz hasta la página actual. */
  items:  BreadcrumbItem[]
  /** URL absoluta del sitio para normalizar items relativos. */
  appUrl: string
}

export function StructuredDataBreadcrumb({ items, appUrl }: BreadcrumbProps) {
  // Normaliza URLs relativas a absolutas. Google EXIGE URLs absolutas en
  // BreadcrumbList → si pones una relativa, ignora el schema entero.
  const baseUrl = appUrl.replace(/\/$/, "")
  const breadcrumbSchema = {
    "@context":      "https://schema.org",
    "@type":         "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type":   "ListItem",
      position:  i + 1,
      name:      item.name,
      item:      item.url.startsWith("http") ? item.url : `${baseUrl}${item.url}`,
    })),
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
    />
  )
}
