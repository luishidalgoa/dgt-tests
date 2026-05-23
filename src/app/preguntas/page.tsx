import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeft, FileQuestion, ArrowRight } from "lucide-react"
import { db } from "@/lib/db"
import { FREE_CATEGORY_SLUG } from "@/lib/permissions"
import { questionToSlug } from "@/lib/questionUrl"
import { isSeoExposeProQuestions } from "@/lib/configCatalog"
import { StructuredDataBreadcrumb } from "@/components/StructuredData"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://dgt-tests.vercel.app"

// 24h de caché. Cuando se publican preguntas nuevas o se cambian de tier,
// se regenera el listado al día siguiente sin redeploy.
export const revalidate = 86400

export async function generateMetadata(): Promise<Metadata> {
  const expose = await isSeoExposeProQuestions()
  const title = expose
    ? "Preguntas del examen DGT — banco completo"
    : "Preguntas del examen DGT — Permiso B"
  const description = expose
    ? "Banco completo de preguntas oficiales del examen teórico DGT (Permiso B, Repaso final y ADAS) organizadas por tema. Cada pregunta con su respuesta correcta y explicación detallada, gratis y sin registro."
    : "Banco de preguntas oficiales del examen teórico del Permiso B, organizadas por tema. Cada pregunta con su respuesta correcta y explicación detallada, gratis y sin registro."
  return {
    title,
    description,
    alternates: { canonical: "/preguntas" },
    openGraph: {
      type:        "website",
      title,
      description: expose
        ? "Banco completo de preguntas del examen teórico DGT con respuestas y explicaciones."
        : "Banco de preguntas oficiales del examen teórico DGT con respuestas y explicaciones.",
    },
  }
}

/**
 * /preguntas — Índice maestro de preguntas indexables.
 *
 * Propósito SEO: que cada pregunta indexable esté linkada desde una
 * sola página, agrupada por codigoTema. Google crawlea todos los
 * enlaces y descubre las URLs individuales — esto pesa MUCHO más
 * que el sitemap.xml (que solo discovery, sin pasar PageRank ni
 * anchor text).
 *
 * Tamaño según el toggle SEO_EXPOSE_PRO_QUESTIONS:
 *  - OFF: ~210 preguntas FREE de permiso-b
 *  - ON:  ~2.500 (todas las categorías + todos los tiers)
 *
 * UX: las preguntas se muestran agrupadas por tema en <details>
 * colapsables. Por defecto desplegado el primer tema; los demás
 * cerrados para no abrumar al usuario.
 *
 * Cada grupo lleva un <h2> y cada pregunta es un <Link> textual con
 * el enunciado entero — Google ve un sitemap interno claro.
 */
export default async function PreguntasIndexPage() {
  // Si el toggle SEO está ON, listamos TODO. Si OFF, solo FREE de permiso-b.
  const expose = await isSeoExposeProQuestions()
  const questions = await db.question.findMany({
    where: expose
      ? {
          // ON: cualquier tier, cualquier categoría. Solo excluimos las
          // AI descartadas y las que no estén asociadas a ningún test.
          testQuestions: { some: {} },
          OR: [{ aiApproved: { not: false } }, { aiApproved: null }],
        }
      : {
          // OFF: solo FREE de permiso-b.
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
      // Necesitamos la categoría real para construir la URL — no todas
      // las preguntas son de permiso-b cuando el toggle está ON.
      testQuestions: {
        take:  1,
        orderBy: { test: { testNumber: "asc" } },
        select: { test: { select: { category: { select: { slug: true, name: true } } } } },
      },
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
            {expose ? (
              <>
                Banco completo de preguntas oficiales del examen teórico
                DGT — <b>Permiso B</b>, <b>Repaso final</b> y{" "}
                <b>ADAS</b> — organizadas por tema. Cada pregunta lleva
                su respuesta correcta y explicación detallada. Si quieres
                practicar tests completos con cronómetro, hazlo desde la{" "}
                <Link href="/">página de inicio</Link>.
              </>
            ) : (
              <>
                Banco de preguntas oficiales del examen teórico del{" "}
                <b>Permiso B</b> organizadas por tema. Cada pregunta
                lleva su respuesta correcta y explicación detallada —
                gratis y sin registro. Si quieres practicar tests
                completos con cronómetro, hazlo desde la{" "}
                <Link href="/">página de inicio</Link>.
              </>
            )}
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
                // Cogemos la categoría real (vía testQuestions). Fallback
                // a permiso-b si por lo que sea no hay test asociado (no
                // debería pasar — la query exige al menos un test).
                const cat = q.testQuestions[0]?.test.category
                const catSlug = cat?.slug ?? FREE_CATEGORY_SLUG
                return (
                  <li key={q.id} style={{ borderTop: "1px solid var(--slate-100)" }}>
                    <Link
                      href={`/preguntas/${catSlug}/${slug}`}
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
                      <span style={{ flex: 1, minWidth: 0 }}>
                        {/* Cuando el toggle ON mezcla categorías, mostramos
                            un mini-badge con la categoría para que el user
                            sepa de dónde viene cada pregunta. */}
                        {expose && cat && cat.slug !== FREE_CATEGORY_SLUG && (
                          <span
                            style={{
                              display:       "inline-block",
                              fontSize:      10.5,
                              fontWeight:    800,
                              padding:       "1px 6px",
                              borderRadius:  4,
                              background:    "rgba(168, 85, 247, 0.10)",
                              color:         "rgb(126, 34, 206)",
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                              marginRight:   8,
                              verticalAlign: "middle",
                            }}
                          >
                            {cat.name}
                          </span>
                        )}
                        {q.enunciado}
                      </span>
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
