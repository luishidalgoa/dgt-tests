import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeft, FileQuestion, ArrowRight } from "lucide-react"
import { db } from "@/lib/db"
import { FREE_CATEGORY_SLUG } from "@/lib/permissions"
import { questionToSlug } from "@/lib/questionUrl"
import { StructuredDataBreadcrumb } from "@/components/StructuredData"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://dgt-tests.vercel.app"

// 24h de caché. Cuando se publican preguntas nuevas o se cambian de tier,
// se regenera el listado al día siguiente sin redeploy.
export const revalidate = 86400

export const metadata: Metadata = {
  title:       "Preguntas del examen DGT — Permiso B",
  description: "Banco de preguntas oficiales del examen teórico del Permiso B, organizadas por tema. Cada pregunta con su respuesta correcta y explicación detallada, gratis y sin registro.",
  alternates:  { canonical: "/preguntas" },
  openGraph: {
    type:        "website",
    title:       "Preguntas del examen DGT — Permiso B",
    description: "Banco de preguntas oficiales del examen teórico DGT con respuestas y explicaciones.",
  },
}

/**
 * /preguntas — Índice maestro de preguntas indexables.
 *
 * Propósito SEO: que las ~210 preguntas FREE estén linkadas desde una
 * sola página, agrupadas por codigoTema. Google crawlea todos los
 * enlaces y descubre las URLs individuales sin depender exclusivamente
 * del sitemap.xml (internal linking pesa más que sitemap).
 *
 * UX: las preguntas se muestran agrupadas por tema en <details>
 * colapsables. Por defecto desplegado el primer tema; los demás
 * cerrados para no abrumar al usuario.
 *
 * Cada grupo lleva un <h2> y cada pregunta es un <Link> textual con
 * el enunciado entero — Google ve un sitemap interno claro.
 */
export default async function PreguntasIndexPage() {
  // Carga TODAS las FREE de permiso-b. La aprobación IA (aiApproved !=
  // false) filtra las descartadas; null o true se muestran.
  const questions = await db.question.findMany({
    where: {
      tier: "FREE",
      testQuestions: {
        some: { test: { category: { slug: FREE_CATEGORY_SLUG } } },
      },
      OR: [{ aiApproved: { not: false } }, { aiApproved: null }],
    },
    orderBy: [
      { codigoTema: "asc" },
      { id:         "asc" },
    ],
    select: {
      id:         true,
      enunciado:  true,
      codigoTema: true,
    },
  })

  // Agrupa por codigoTema. Si el codigoTema es null → grupo "Otras".
  const byTema = new Map<string, typeof questions>()
  for (const q of questions) {
    const tema = q.codigoTema ?? "Otras"
    const arr = byTema.get(tema) ?? []
    arr.push(q)
    byTema.set(tema, arr)
  }
  const grupos = Array.from(byTema.entries())

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <StructuredDataBreadcrumb
        appUrl={APP_URL}
        items={[
          { name: "Inicio",    url: "/" },
          { name: "Preguntas", url: "/preguntas" },
        ]}
      />

      <Link href="/" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Inicio
      </Link>

      <header className="page-header">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12, margin: 0 }}>
            <FileQuestion className="h-7 w-7" style={{ color: "var(--orange-600)" }} />
            Preguntas del examen DGT
          </h1>
          <p className="lead" style={{ marginTop: 10 }}>
            Banco de preguntas oficiales del examen teórico del{" "}
            <b>Permiso B</b> organizadas por tema. Cada pregunta lleva
            su respuesta correcta y explicación detallada — gratis y
            sin registro. Si quieres practicar tests completos con
            cronómetro, hazlo desde la <Link href="/">página de inicio</Link>.
          </p>
        </div>
      </header>

      <p style={{ fontSize: 13, color: "var(--slate-500)", marginTop: 16, marginBottom: 18 }}>
        <b>{questions.length}</b> preguntas disponibles · agrupadas en{" "}
        <b>{grupos.length}</b> {grupos.length === 1 ? "tema" : "temas"}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {grupos.map(([tema, items], i) => (
          <details
            key={tema}
            // Solo el primer tema abierto por defecto — los demás cerrados
            // para no presentar 200+ items de golpe.
            open={i === 0}
            className="card-soft"
            style={{ padding: 0, overflow: "hidden" }}
          >
            <summary
              style={{
                cursor:        "pointer",
                padding:       "14px 18px",
                listStyle:     "none",
                display:       "flex",
                alignItems:    "center",
                justifyContent: "space-between",
                gap:           12,
                background:    "rgba(148, 163, 184, 0.06)",
                fontWeight:    700,
                userSelect:    "none",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span
                  style={{
                    flexShrink:   0,
                    fontFamily:   "var(--font-jetbrains-mono, monospace)",
                    fontSize:     11,
                    padding:      "2px 8px",
                    borderRadius: 999,
                    background:   "rgba(249, 115, 22, 0.12)",
                    color:        "var(--orange-600)",
                  }}
                >
                  {tema}
                </span>
                <span style={{ fontSize: 14, color: "var(--slate-700)" }}>
                  {items.length} {items.length === 1 ? "pregunta" : "preguntas"}
                </span>
              </span>
            </summary>
            <ul style={{ margin: 0, padding: "0 18px 18px", listStyle: "none" }}>
              {items.map((q) => {
                const slug = questionToSlug({ id: q.id, enunciado: q.enunciado })
                return (
                  <li key={q.id} style={{ borderTop: "1px solid var(--slate-100)" }}>
                    <Link
                      href={`/preguntas/${FREE_CATEGORY_SLUG}/${slug}`}
                      style={{
                        display:        "flex",
                        alignItems:     "center",
                        justifyContent: "space-between",
                        gap:            10,
                        padding:        "12px 0",
                        fontSize:       14,
                        lineHeight:     1.5,
                        color:          "var(--slate-700)",
                        textDecoration: "none",
                      }}
                    >
                      <span style={{ flex: 1 }}>{q.enunciado}</span>
                      <ArrowRight className="h-4 w-4 flex-shrink-0" style={{ color: "var(--orange-600)" }} />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </details>
        ))}
      </div>

      {/* CTA final */}
      <section
        className="card-soft warm"
        style={{
          padding:        20,
          marginTop:      24,
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          gap:            14,
          flexWrap:       "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <p style={{ margin: 0, fontWeight: 800, fontSize: 15 }}>
            ¿Listo para un test completo?
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--slate-600)" }}>
            7 tests del Permiso B con 30 preguntas cada uno, modo examen
            con cronómetro y explicaciones de la IA.
          </p>
        </div>
        <Link href="/" className="btn-primary" style={{ whiteSpace: "nowrap" }}>
          Empezar un test →
        </Link>
      </section>
    </div>
  )
}
