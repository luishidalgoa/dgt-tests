import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeft, BookOpen, Clock, ArrowRight } from "lucide-react"
import { RECURSOS } from "@/content/recursos/_registry"
import { StructuredDataBreadcrumb } from "@/components/StructuredData"

export const metadata: Metadata = {
  title:       "Recursos · Guías sobre el examen DGT",
  description: "Guías y artículos en profundidad sobre el examen teórico del carné de conducir: cuánto cuesta, cuántos fallos puedes tener, bloque ADAS, plazos y trámites.",
  alternates:  { canonical: "/recursos" },
  openGraph: {
    type:        "website",
    title:       "Recursos · Guías sobre el examen DGT",
    description: "Guías en profundidad sobre el examen teórico del carné de conducir.",
  },
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://dgt-tests.vercel.app"

/**
 * /recursos — Índice de guías largas sobre el examen DGT.
 *
 * Estructura SEO:
 *  - H1 con keyword "examen DGT" en el título.
 *  - Lista de cards con H2 por artículo (Title → /recursos/[slug]).
 *  - Cada card tiene meta de tiempo de lectura + excerpt.
 *  - BreadcrumbList JSON-LD para SERPs.
 *  - Indexable y descubrible desde sitemap.xml.
 */
export default function RecursosIndexPage() {
  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <StructuredDataBreadcrumb
        appUrl={APP_URL}
        items={[
          { name: "Inicio",   url: "/" },
          { name: "Recursos", url: "/recursos" },
        ]}
      />

      <Link href="/" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Inicio
      </Link>

      <header className="page-header">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12, margin: 0 }}>
            <BookOpen className="h-7 w-7" style={{ color: "var(--orange-600)" }} />
            Guías del examen DGT
          </h1>
          <p className="lead" style={{ marginTop: 10 }}>
            Artículos en profundidad sobre el examen teórico del carné de
            conducir — cuánto cuesta sacárselo en 2026, cuántos fallos
            puedes tener, qué entra en el bloque ADAS y todo lo que tu
            autoescuela no te explica del todo.
          </p>
        </div>
      </header>

      <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
        {RECURSOS.map((r) => (
          <Link
            key={r.meta.slug}
            href={`/recursos/${r.meta.slug}`}
            className="card-soft"
            style={{
              padding:        22,
              textDecoration: "none",
              color:          "inherit",
              display:        "block",
              transition:     "transform 0.15s, box-shadow 0.15s",
            }}
          >
            <div
              style={{
                fontSize:       11,
                fontWeight:     800,
                color:          "var(--orange-600)",
                textTransform:  "uppercase",
                letterSpacing:  "0.08em",
                display:        "inline-flex",
                alignItems:     "center",
                gap:            6,
                marginBottom:   6,
              }}
            >
              <Clock className="h-3 w-3" />
              {r.meta.readingMinutes} min · {labelForTopic(r.meta.topic)}
            </div>
            <h2 style={{ margin: "2px 0 6px", fontSize: 19, lineHeight: 1.3, letterSpacing: "-0.01em" }}>
              {r.meta.title}
            </h2>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--slate-600)" }}>
              {r.meta.excerpt}
            </p>
            <div
              style={{
                marginTop:  10,
                fontSize:   13,
                fontWeight: 700,
                color:      "var(--orange-600)",
                display:    "inline-flex",
                alignItems: "center",
                gap:        4,
              }}
            >
              Leer guía
              <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </Link>
        ))}
      </div>

      {/* Footer CTA — engancha el visitante de los recursos al producto */}
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
          <p style={{ margin: 0, fontWeight: 800, fontSize: 15 }}>
            ¿Ya lo tienes claro? Empieza a practicar
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--slate-600)" }}>
            Los 7 primeros tests del Permiso B son gratis y sin tarjeta.
          </p>
        </div>
        <Link href="/" className="btn-primary" style={{ whiteSpace: "nowrap" }}>
          Empezar un test →
        </Link>
      </section>
    </div>
  )
}

function labelForTopic(topic: "examen" | "coste" | "adas" | "guia"): string {
  switch (topic) {
    case "examen": return "Examen"
    case "coste":  return "Coste"
    case "adas":   return "ADAS"
    case "guia":   return "Guía"
  }
}
