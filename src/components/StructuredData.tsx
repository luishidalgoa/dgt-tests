/**
 * JSON-LD structured data (Schema.org) para rich results en Google.
 *
 * Renderizamos en el home dos schemas básicos:
 *  - WebSite: identifica el sitio + define la search action (rich result
 *    "Sitelinks Searchbox" en SERPs).
 *  - Organization: identidad de la org responsable (logo, sameAs links
 *    a redes sociales, contacto).
 *
 * Validar tras deploy:
 *   https://search.google.com/test/rich-results?url=https://dgt-tests.vercel.app
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
  // Schema.org permite combinar varios @types en un array. Lo enviamos
  // como dos <script> separados — más fácil de debug en DevTools, y si
  // uno tiene typo Google sigue parseando el otro.
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
      url:     "https://luishidalgoa.vercel.app/",
    },
    // sameAs: links a redes oficiales. Vacío de momento; cuando tengas
    // Twitter/Instagram/LinkedIn oficial de DGT Tests, los añades aquí.
    sameAs: [
      "https://luishidalgoa.vercel.app/",
    ],
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
    </>
  )
}
