import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeft, Clock, ArrowRight, BookOpen } from "lucide-react"
import { RECURSOS, findRecurso, relatedRecursos } from "@/content/recursos/_registry"
import { StructuredDataBreadcrumb } from "@/components/StructuredData"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://dgt-tests.hdglabs.com"

interface PageProps {
  params: Promise<{ slug: string }>
}

/**
 * Pre-renderiza todos los slugs conocidos en build. Si añades un artículo
 * al registry, Next lo genera estático automáticamente al próximo deploy.
 * Páginas estáticas → más rápidas y barato en compute Vercel.
 */
export function generateStaticParams() {
  return RECURSOS.map((r) => ({ slug: r.meta.slug }))
}

/**
 * Metadata dinámico desde el meta del artículo. Title/desc/OG/canonical
 * todos derivan del registry → no se desincronizan.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const entry = findRecurso(slug)
  if (!entry) return {}

  return {
    title:       entry.meta.title,
    description: entry.meta.description,
    alternates:  { canonical: `/recursos/${slug}` },
    openGraph: {
      type:          "article",
      title:         entry.meta.title,
      description:   entry.meta.description,
      publishedTime: entry.meta.publishedAt,
      modifiedTime:  entry.meta.updatedAt,
      authors:       ["https://portfolio.hdglabs.com/"],
    },
  }
}

/**
 * Render del artículo individual.
 *
 * SEO:
 *  - H1 inyectado desde meta.title (el JSX del cuerpo NO lleva H1).
 *  - JSON-LD Article schema con author/published/modified/publisher.
 *  - BreadcrumbList JSON-LD.
 *  - Tipografía CSS-scoped a .article-body para una lectura cómoda
 *    sin tocar el resto del sitio.
 *
 * UX:
 *  - Meta arriba: tiempo de lectura, fecha de publicación.
 *  - Botón "Volver a Recursos" arriba.
 *  - Artículos relacionados + CTA al test al final.
 */
export default async function RecursoArticlePage({ params }: PageProps) {
  const { slug } = await params
  const entry = findRecurso(slug)
  if (!entry) notFound()

  const { meta, Component } = entry
  const related = relatedRecursos(meta.slug, 2)

  // Article schema — rich result tipo "article" en Google News y SERPs.
  const articleSchema = {
    "@context":     "https://schema.org",
    "@type":        "Article",
    headline:       meta.title,
    description:    meta.description,
    inLanguage:     "es-ES",
    datePublished:  meta.publishedAt,
    dateModified:   meta.updatedAt,
    url:            `${APP_URL}/recursos/${meta.slug}`,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id":   `${APP_URL}/recursos/${meta.slug}`,
    },
    author: {
      "@type": "Person",
      name:    "Luis Hidalgo",
      url:     "https://portfolio.hdglabs.com/",
    },
    publisher: {
      "@type": "Organization",
      name:    "DGT Tests",
      url:     APP_URL,
      logo: {
        "@type": "ImageObject",
        url:     `${APP_URL}/icon.svg`,
      },
    },
    // image: usamos el OG global por defecto (no hay imagen específica
    // del artículo todavía). Cuando creemos opengraph-image.tsx por
    // artículo, apuntar aquí a esa URL.
    image: `${APP_URL}/opengraph-image`,
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <StructuredDataBreadcrumb
        appUrl={APP_URL}
        items={[
          { name: "Inicio",   url: "/" },
          { name: "Recursos", url: "/recursos" },
          { name: meta.title, url: `/recursos/${meta.slug}` },
        ]}
      />

      <Link href="/recursos" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Volver a Recursos
      </Link>

      <header style={{ marginTop: 10, marginBottom: 22 }}>
        <div
          style={{
            fontSize:      11.5,
            fontWeight:    800,
            color:         "var(--orange-600)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            display:       "inline-flex",
            alignItems:    "center",
            gap:           8,
            marginBottom:  10,
          }}
        >
          <Clock className="h-3.5 w-3.5" />
          {meta.readingMinutes} min de lectura
          <span style={{ color: "var(--slate-400)" }}>·</span>
          <time dateTime={meta.publishedAt} style={{ color: "var(--slate-500)", fontWeight: 600 }}>
            {formatDate(meta.publishedAt)}
          </time>
        </div>
        <h1
          style={{
            margin:        0,
            fontSize:      32,
            lineHeight:    1.2,
            letterSpacing: "-0.02em",
          }}
        >
          {meta.title}
        </h1>
      </header>

      {/* Cuerpo del artículo. La clase article-body aplica tipografía
          de lectura (line-height, margin entre párrafos, estilos de h2/h3,
          listas, tablas) sin afectar el resto del sitio. */}
      <article className="article-body">
        <Component />
      </article>

      {/* Relacionados */}
      {related.length > 0 && (
        <section style={{ marginTop: 36 }}>
          <h2 style={{ fontSize: 18, marginBottom: 12, color: "var(--slate-700)" }}>
            Sigue leyendo
          </h2>
          <div style={{ display: "grid", gap: 10 }}>
            {related.map((r) => (
              <Link
                key={r.meta.slug}
                href={`/recursos/${r.meta.slug}`}
                className="card-soft"
                style={{
                  padding:        16,
                  textDecoration: "none",
                  color:          "inherit",
                  display:        "flex",
                  alignItems:     "center",
                  justifyContent: "space-between",
                  gap:            12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 800, fontSize: 14.5, lineHeight: 1.35 }}>
                    {r.meta.title}
                  </p>
                  <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "var(--slate-500)" }}>
                    {r.meta.readingMinutes} min de lectura
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 flex-shrink-0" style={{ color: "var(--orange-600)" }} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* CTA final hacia el producto */}
      <section
        className="card-soft warm"
        style={{
          padding:        20,
          marginTop:      20,
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          gap:            14,
          flexWrap:       "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <p style={{ margin: 0, fontWeight: 800, fontSize: 15, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <BookOpen className="h-4 w-4" style={{ color: "var(--orange-600)" }} />
            Practica con tests gratis
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--slate-600)" }}>
            7 tests del Permiso B sin registro. Si necesitas explicación,
            la IA te la da.
          </p>
        </div>
        <Link href="/" className="btn-primary" style={{ whiteSpace: "nowrap" }}>
          Empezar →
        </Link>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" })
}
