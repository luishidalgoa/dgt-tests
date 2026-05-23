import type { Metadata } from "next"
import Link from "next/link"
import Image from "next/image"
import { notFound, redirect } from "next/navigation"
import { ChevronLeft, CheckCircle2, XCircle, Lightbulb, BookOpen, ArrowRight } from "lucide-react"
import { db } from "@/lib/db"
import { imageUrl } from "@/lib/imageUrl"
import { questionToSlug, questionIdFromSlug } from "@/lib/questionUrl"
import { StructuredDataBreadcrumb } from "@/components/StructuredData"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://dgt-tests.vercel.app"

// Cache 24h en CDN/edge. Las preguntas DGT no cambian a menos que sea
// una corrección puntual del enunciado → revalidar diario es suficiente.
export const revalidate = 86400

interface PageProps {
  params: Promise<{ categoria: string; slug: string }>
}

/**
 * Metadata SEO de la pregunta individual.
 *
 * Estrategia: el <title> contiene el INICIO del enunciado (no truncamos al
 * azar — cortamos en el primer signo de interrogación o a los 60 chars en
 * límite de palabra). Eso maximiza el match con queries textuales que la
 * gente busca: "puede un coche llevar solamente el espejo exterior..."
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { categoria, slug } = await params
  const id = questionIdFromSlug(slug)
  if (!id) return {}

  const q = await db.question.findFirst({
    where: {
      id,
      tier:       "FREE",
      // Excluimos solo las AI descartadas. null=humana, true=AI aprobada,
      // false=AI descartada (no se muestra).
      OR: [{ aiApproved: { not: false } }, { aiApproved: null }],
    },
    select: { enunciado: true, codigoTema: true },
  })
  if (!q) return {}

  const shortTitle = trimToWord(q.enunciado, 65)
  const temaSuffix = q.codigoTema ? ` Tema ${q.codigoTema}.` : ""

  return {
    title:       shortTitle,
    description: `Pregunta del examen teórico DGT con explicación detallada y respuesta correcta.${temaSuffix} Practica gratis con tests reales del Permiso B.`,
    alternates:  { canonical: `/preguntas/${categoria}/${slug}` },
    openGraph: {
      type:        "article",
      title:       shortTitle,
      description: `Pregunta del examen teórico DGT con explicación detallada.${temaSuffix}`,
    },
  }
}

/**
 * Render de la pregunta individual — la página SEO target.
 *
 * Flujo:
 *  1. Extrae id del slug. Si malformado → 404.
 *  2. Carga la pregunta con sus opciones + test+categoría asociada.
 *  3. Filtra: tier=FREE, no descartada por review IA.
 *  4. Verifica que el `categoria` del param coincida con la categoría
 *     real de la pregunta — si no, 404 (evita URLs duplicadas).
 *  5. Si el slug no es el canónico (alguien tuneó el slug a mano),
 *     redirige 301-style al canónico.
 *  6. Carga preguntas relacionadas del mismo codigoTema.
 *  7. Renderiza con JSON-LD Question + BreadcrumbList.
 *
 * Acceso: PÚBLICO. Cualquier guest puede ver la pregunta entera
 * (opciones + cuál es correcta + explicación). Es lo que practicatest
 * hace y lo que indexa Google. El moat del producto es la UX, no las
 * preguntas (que son datos públicos DGT de todos modos).
 */
export default async function QuestionPage({ params }: PageProps) {
  const { categoria, slug } = await params
  const id = questionIdFromSlug(slug)
  if (!id) notFound()

  const question = await db.question.findFirst({
    where: {
      id,
      tier:       "FREE",
      OR: [{ aiApproved: { not: false } }, { aiApproved: null }],
    },
    include: {
      options: { orderBy: { letra: "asc" } },
      // Cogemos solo el primer test al que pertenece — para mostrar
      // "Esta pregunta sale en el Test N del Permiso B".
      testQuestions: {
        take: 1,
        orderBy: { test: { testNumber: "asc" } },
        include: { test: { include: { category: true } } },
      },
    },
  })
  if (!question) notFound()

  const realCategory = question.testQuestions[0]?.test.category
  // Si la pregunta no está asociada a ningún test (huérfana) no debería
  // ser FREE — pero por seguridad 404.
  if (!realCategory) notFound()
  // El categoria del param tiene que coincidir con la real. Si alguien
  // mete /preguntas/repaso-final/<slug-de-permiso-b> → 404.
  if (realCategory.slug !== categoria) notFound()

  // Canonicaliza el slug. Si el visitante cambia algo del texto pero
  // mantiene el -id final, redirigimos a la URL correcta (mejor SEO,
  // evita contenido duplicado para Google).
  const canonicalSlug = questionToSlug({ id: question.id, enunciado: question.enunciado })
  if (slug !== canonicalSlug) {
    redirect(`/preguntas/${categoria}/${canonicalSlug}`)
  }

  // Preguntas relacionadas: mismo tema, FREE, no descartadas, excluida
  // la actual. Take 5. Si no hay codigoTema o no hay suficientes,
  // rellenamos con random de la misma categoría.
  const sameTema = question.codigoTema
    ? await db.question.findMany({
        where: {
          codigoTema: question.codigoTema,
          tier:       "FREE",
          id:         { not: question.id },
          OR: [{ aiApproved: { not: false } }, { aiApproved: null }],
        },
        take:   5,
        select: { id: true, enunciado: true, codigoTema: true },
      })
    : []

  let related = sameTema
  if (related.length < 5) {
    const fill = await db.question.findMany({
      where: {
        tier: "FREE",
        id:   { notIn: [question.id, ...related.map((r) => r.id)] },
        testQuestions: { some: { test: { category: { slug: categoria } } } },
        OR: [{ aiApproved: { not: false } }, { aiApproved: null }],
      },
      take:   5 - related.length,
      select: { id: true, enunciado: true, codigoTema: true },
    })
    related = [...related, ...fill]
  }

  const testInfo = question.testQuestions[0]
  const correctOption = question.options.find((o) => o.isCorrect)

  // JSON-LD Question schema → rich result en SERPs con la pregunta +
  // respuesta directamente visible bajo el título.
  const questionSchema = {
    "@context":     "https://schema.org",
    "@type":        "Question",
    name:           question.enunciado,
    text:           question.enunciado,
    inLanguage:     "es-ES",
    url:            `${APP_URL}/preguntas/${categoria}/${canonicalSlug}`,
    answerCount:    1,
    acceptedAnswer: correctOption
      ? {
          "@type": "Answer",
          text:    `${correctOption.letra}) ${correctOption.texto}. ${question.explicacion}`,
        }
      : undefined,
    // Las otras opciones como suggestedAnswer — Google puede mostrarlas
    // como contexto en SERPs.
    suggestedAnswer: question.options
      .filter((o) => !o.isCorrect)
      .map((o) => ({
        "@type": "Answer",
        text:    `${o.letra}) ${o.texto}`,
      })),
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <StructuredDataBreadcrumb
        appUrl={APP_URL}
        items={[
          { name: "Inicio",            url: "/" },
          { name: "Preguntas",         url: "/preguntas" },
          { name: realCategory.name,   url: `/preguntas/${categoria}` },
          { name: trimToWord(question.enunciado, 50), url: `/preguntas/${categoria}/${canonicalSlug}` },
        ]}
      />

      <Link href="/preguntas" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Todas las preguntas
      </Link>

      {/* Meta arriba: categoría + tema */}
      <div
        style={{
          marginTop:     8,
          marginBottom:  16,
          fontSize:      11.5,
          fontWeight:    800,
          color:         "var(--orange-600)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {realCategory.name}
        {question.codigoTema && (
          <>
            {" "}
            <span style={{ color: "var(--slate-400)" }}>·</span>
            <span style={{ color: "var(--slate-500)", marginLeft: 6, fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
              {question.codigoTema}
            </span>
          </>
        )}
      </div>

      <header style={{ marginBottom: 22 }}>
        <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.35, letterSpacing: "-0.01em" }}>
          {question.enunciado}
        </h1>
      </header>

      {/* Imagen (si tiene) */}
      {question.imagen && (
        <div
          className="card-soft"
          style={{
            padding:        12,
            marginBottom:   20,
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            background:     "var(--slate-50, #f8fafc)",
          }}
        >
          <div
            style={{
              position: "relative",
              width:    "100%",
              maxWidth: 480,
              aspectRatio: "4 / 3",
            }}
          >
            <Image
              src={imageUrl(question.imagen)}
              alt={trimToWord(question.enunciado, 80)}
              fill
              sizes="(max-width: 760px) 92vw, 480px"
              style={{ objectFit: "contain" }}
              priority
            />
          </div>
        </div>
      )}

      {/* Opciones — todas visibles, la correcta marcada */}
      <section style={{ marginBottom: 22 }}>
        <h2
          style={{
            fontSize:      11,
            fontWeight:    800,
            color:         "var(--slate-500)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            margin:        "0 0 10px",
          }}
        >
          Opciones de respuesta
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {question.options.map((opt) => {
            const isCorrect = opt.isCorrect
            return (
              <div
                key={opt.id}
                style={{
                  display:    "flex",
                  alignItems: "flex-start",
                  gap:        12,
                  padding:    "12px 14px",
                  borderRadius: 12,
                  border:     isCorrect
                    ? "2px solid var(--green)"
                    : "1.5px solid var(--slate-200)",
                  background: isCorrect ? "rgba(34, 197, 94, 0.06)" : "#fff",
                }}
              >
                <span
                  style={{
                    flexShrink:   0,
                    width:        30,
                    height:       30,
                    borderRadius: "50%",
                    background:   isCorrect ? "var(--green)" : "var(--slate-100)",
                    color:        isCorrect ? "#fff" : "var(--slate-600)",
                    fontWeight:   800,
                    fontSize:     13,
                    display:      "inline-flex",
                    alignItems:   "center",
                    justifyContent: "center",
                  }}
                >
                  {opt.letra}
                </span>
                <span style={{ flex: 1, fontSize: 14.5, lineHeight: 1.55 }}>
                  {opt.texto}
                </span>
                {isCorrect ? (
                  <CheckCircle2 className="h-5 w-5 flex-shrink-0" style={{ color: "var(--green)", marginTop: 2 }} />
                ) : (
                  <XCircle className="h-5 w-5 flex-shrink-0" style={{ color: "var(--slate-300)", marginTop: 2 }} />
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* Explicación */}
      <section
        className="card-soft"
        style={{
          padding:    16,
          marginBottom: 22,
          background: "rgba(245, 158, 11, 0.06)",
          borderColor: "rgba(245, 158, 11, 0.25)",
        }}
      >
        <div
          style={{
            display:    "inline-flex",
            alignItems: "center",
            gap:        8,
            fontSize:   12.5,
            fontWeight: 800,
            color:      "var(--amber-d, #92400e)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 8,
          }}
        >
          <Lightbulb className="h-4 w-4" />
          Explicación
        </div>
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.65, color: "var(--slate-700)" }}>
          {question.explicacion}
        </p>
      </section>

      {/* CTA al test completo donde aparece esta pregunta */}
      {testInfo && (
        <section
          className="card-soft warm"
          style={{
            padding:        18,
            marginBottom:   22,
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
              Esta pregunta sale en el Test {testInfo.test.testNumber}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--slate-600)" }}>
              Haz el test completo con sus 30 preguntas y comprueba cuántas aciertas.
            </p>
          </div>
          <Link href={`/${realCategory.slug}/${testInfo.test.testNumber}`} className="btn-primary" style={{ whiteSpace: "nowrap" }}>
            Empezar Test {testInfo.test.testNumber} →
          </Link>
        </section>
      )}

      {/* Otras preguntas de conducción */}
      {related.length > 0 && (
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 18, margin: "0 0 12px", color: "var(--slate-700)" }}>
            Otras preguntas de conducción
          </h2>
          <div style={{ display: "grid", gap: 8 }}>
            {related.map((r) => {
              const rSlug = questionToSlug({ id: r.id, enunciado: r.enunciado })
              return (
                <Link
                  key={r.id}
                  href={`/preguntas/${categoria}/${rSlug}`}
                  className="card-soft"
                  style={{
                    padding:        14,
                    textDecoration: "none",
                    color:          "inherit",
                    display:        "flex",
                    alignItems:     "center",
                    justifyContent: "space-between",
                    gap:            10,
                  }}
                >
                  <span style={{ fontSize: 14, lineHeight: 1.4, flex: 1 }}>
                    {trimToWord(r.enunciado, 110)}
                  </span>
                  <ArrowRight className="h-4 w-4 flex-shrink-0" style={{ color: "var(--orange-600)" }} />
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* CTA final hacia el producto completo */}
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
            Practica con tests reales
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--slate-600)" }}>
            7 tests del Permiso B gratis · IA que te explica cada
            respuesta · modo examen real con cronómetro.
          </p>
        </div>
        <Link href="/" className="btn-primary" style={{ whiteSpace: "nowrap" }}>
          Empezar gratis →
        </Link>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(questionSchema) }}
      />
    </div>
  )
}

/**
 * Corta una cadena a `max` chars cayendo en el último espacio o signo
 * de interrogación previo. Evita títulos truncados a mitad de palabra.
 */
function trimToWord(s: string, max: number): string {
  const cleaned = s.trim()
  if (cleaned.length <= max) return cleaned
  let cut = cleaned.slice(0, max)
  // Si justo en `max` cae signo de cierre interrogación, corta ahí
  // (mejor lectura para "¿Puede el coche...?" cortado a 65).
  const closingQ = cut.lastIndexOf("?")
  if (closingQ > 30) return cut.slice(0, closingQ + 1)
  // Cae en último espacio (palabra completa).
  const lastSpace = cut.lastIndexOf(" ")
  if (lastSpace > 30) cut = cut.slice(0, lastSpace)
  return cut.trim() + "…"
}
