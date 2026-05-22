import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import {
  getTemaName,
  extractTemaPrefix,
  extractTemaInner,
  compareTemaCodes,
} from "@/lib/temas"
import { Prisma } from "@prisma/client"
import { shuffle } from "@/lib/shuffle"
import { QUESTION_VISIBLE_WHERE, SQL_QUESTION_VISIBLE_AND } from "@/lib/questions"
import { getSubBloqueInfo } from "@/lib/manualIndice"
import { ExamRunner } from "@/components/ExamRunner"
import { getEffectiveTokenQuota, hasFullAccess } from "@/lib/permissions"
import { getQuotaStatus } from "@/lib/aiQuota"
import { Badge } from "@/components/ui/badge"
import { ChevronLeft, BookMarked, Sparkles, ArrowRight, Shuffle } from "lucide-react"
import type { TestRunnerData } from "@/types/exam"

export const dynamic = "force-dynamic"

interface PageProps {
  params:       Promise<{ prefix: string }>
  searchParams: Promise<{ n?: string }>
}

/**
 * Umbrales para decidir si subdividimos un subtema en sub-bloques internos.
 * - SPLIT_MIN_TOTAL    : a partir de cuántas preguntas merece la pena dividir.
 * - SPLIT_MIN_BUCKETS  : mínimo de sub-bloques distintos para que valga la pena.
 *
 * Por debajo de cualquiera de esos, mostramos el selector clásico
 * (10/20/30/todas) y dejamos hacer el test del subtema entero.
 */
const SPLIT_MIN_TOTAL   = 50
const SPLIT_MIN_BUCKETS = 3

export default async function TemaPage({ params, searchParams }: PageProps) {
  const user = await getCurrentUser()
  if (!user) redirect("/")
  // /temas es feature PRO. Free users → /upgrade.
  if (!hasFullAccess(user)) redirect("/upgrade")
  const { prefix: rawPrefix } = await params
  const sp = await searchParams
  const prefix = decodeURIComponent(rawPrefix)
  const requested = sp.n ? Math.max(1, Math.min(parseInt(sp.n, 10), 200)) : null

  // Recuperamos TODAS las preguntas con codigoTema y filtramos en JS por el
  // prefijo. Hacerlo así (en vez de un LIKE en SQL) captura también las
  // preguntas con codigoTema sin guion estructural (p.ej. "TC 2.8 (2-8.1)"
  // que el LIKE 'TC 2.8-%' anterior se perdía).
  const all = await db.$queryRaw<{ id: number; codigoTema: string }[]>`
    SELECT id, codigoTema FROM questions q WHERE codigoTema IS NOT NULL ${Prisma.raw(SQL_QUESTION_VISIBLE_AND)}
  `
  const matched = all.filter((q) => extractTemaPrefix(q.codigoTema) === prefix)
  const allQuestionIds = matched.map((q) => ({ id: q.id }))
  const totalAvailable = allQuestionIds.length

  if (totalAvailable === 0) notFound()

  // Vista de selección (sin ?n=)
  if (!requested) {
    // Stats del subtema para el usuario
    const answered = await db.answer.count({
      where: {
        questionId: { in: allQuestionIds.map((q) => q.id) },
        attempt:    { userId: user.id },
      },
    })
    const correct = await db.answer.count({
      where: {
        questionId: { in: allQuestionIds.map((q) => q.id) },
        isCorrect:  true,
        attempt:    { userId: user.id },
      },
    })
    const acc = answered > 0 ? (correct / answered) * 100 : null

    // Calcular desglose por sub-bloque interno (ej: "5.3", "6", "3.4"…).
    // Las preguntas sin guion estructural caen en bucket "general".
    const GENERAL_BUCKET = "general"
    const byInner = new Map<string, number>()
    for (const q of matched) {
      const inner = extractTemaInner(q.codigoTema) ?? GENERAL_BUCKET
      byInner.set(inner, (byInner.get(inner) ?? 0) + 1)
    }
    const innerBuckets = [...byInner.entries()].map(([inner, count]) => ({ inner, count }))
    innerBuckets.sort((a, b) => {
      // "general" siempre al final; el resto, por código numérico.
      if (a.inner === GENERAL_BUCKET) return 1
      if (b.inner === GENERAL_BUCKET) return -1
      return compareTemaCodes(`TC ${a.inner}`, `TC ${b.inner}`)
    })

    const shouldSplit =
      totalAvailable >= SPLIT_MIN_TOTAL && innerBuckets.length >= SPLIT_MIN_BUCKETS

    return (
      <div>
        <Link href="/temas" className="back-link">
          <ChevronLeft className="h-4 w-4" />
          Todos los temas
        </Link>

        <header className="page-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <BookMarked className="h-6 w-6" style={{ color: "var(--orange-600)" }} />
              <span className="badge">{prefix}</span>
            </div>
            <h1>{getTemaName(prefix)}</h1>
          </div>
        </header>

        {/* RESUMEN: total + acierto */}
        <div className="card-soft warm" style={{ padding: 28, marginBottom: shouldSplit ? 22 : 6 }}>
          <div className="flex items-center justify-between gap-6 flex-wrap mb-6">
            <div>
              <div style={{ fontSize: 11.5, color: "var(--slate-500)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Preguntas en este tema
              </div>
              <div className="font-mono-tabular" style={{ fontSize: 44, fontWeight: 900, marginTop: 4, letterSpacing: "-0.03em" }}>
                {totalAvailable}
              </div>
            </div>
            {acc !== null && (
              <div className="text-right">
                <div style={{ fontSize: 11.5, color: "var(--slate-500)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Tu acierto
                </div>
                <div
                  className="font-mono-tabular"
                  style={{
                    fontSize: 44,
                    fontWeight: 900,
                    marginTop: 4,
                    letterSpacing: "-0.03em",
                    color: acc < 70 ? "var(--red-500)" : acc >= 90 ? "var(--green)" : "var(--amber)",
                  }}
                >
                  {acc.toFixed(0)}%
                </div>
                <div style={{ fontSize: 12, color: "var(--slate-500)" }}>
                  {correct}/{answered} respuestas
                </div>
              </div>
            )}
            <Sparkles className="h-10 w-10 hidden lg:block" style={{ color: "var(--amber)" }} />
          </div>

          {shouldSplit ? (
            // SUBTEMA GRANDE: ofrece test completo aleatorio como atajo arriba.
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10, color: "var(--slate-700)" }}>
                ¿Practicar todo el tema?
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/temas/${rawPrefix}?n=${Math.min(30, totalAvailable)}`}
                  className="btn-secondary"
                >
                  <Shuffle className="h-4 w-4" />
                  Aleatorio · 30
                </Link>
                <Link href={`/temas/${rawPrefix}?n=${totalAvailable}`} className="btn-primary">
                  Todas ({totalAvailable})
                </Link>
              </div>
              <p style={{ fontSize: 12, color: "var(--slate-500)", marginTop: 14, marginBottom: 0 }}>
                O elige un sub-bloque concreto más abajo para hacer un test corto.
              </p>
            </div>
          ) : (
            // SUBTEMA NORMAL: selector clásico de cantidad.
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10, color: "var(--slate-700)" }}>
                ¿Cuántas preguntas quieres practicar?
              </div>
              <div className="flex flex-wrap gap-2">
                {[10, 20, 30, totalAvailable]
                  .filter((n, i, arr) => n <= totalAvailable && arr.indexOf(n) === i)
                  .map((n) => (
                    <Link
                      key={n}
                      href={`/temas/${rawPrefix}?n=${n}`}
                      className={n === totalAvailable ? "btn-primary" : "btn-secondary"}
                    >
                      {n === totalAvailable ? `Todas (${n})` : n}
                    </Link>
                  ))}
              </div>
              <p style={{ fontSize: 12, color: "var(--slate-500)", marginTop: 18, marginBottom: 0 }}>
                Las preguntas se seleccionan en orden aleatorio entre las {totalAvailable} disponibles.
              </p>
            </div>
          )}
        </div>

        {/* GRID DE SUB-BLOQUES (solo si shouldSplit) */}
        {shouldSplit && (
          <section>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                padding: "0 4px",
                marginBottom: 10,
              }}
            >
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "var(--slate-700)" }}>
                Sub-bloques del tema
              </h2>
              <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--slate-400)" }}>
                {innerBuckets.length} bloques
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {innerBuckets.map((b) => {
                // Buscar título legible del sub-bloque en manualIndice.json.
                // El subCode jerárquico es `bloque-prefix-sin-TC + "." + inner`,
                // p.ej. "1.2" + "." + "5.3" → "1.2.5.3".
                const subCode = b.inner === "general"
                  ? null
                  : `${prefix.replace(/^TC\s+/, "")}.${b.inner}`
                const subTitle = subCode ? getSubBloqueInfo(subCode)?.titulo : null
                return (
                <Link
                  key={b.inner}
                  href={`/temas/${rawPrefix}/${encodeURIComponent(b.inner)}`}
                  className="card-soft"
                  style={{
                    padding: 18,
                    textDecoration: "none",
                    color: "inherit",
                    display: "block",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <span
                        className="font-mono-tabular"
                        style={{
                          display: "inline-block",
                          padding: "3px 9px",
                          borderRadius: 6,
                          background: "rgba(168, 85, 247, 0.10)",
                          color: "rgb(126, 34, 206)",
                          fontSize: 11.5,
                          fontWeight: 700,
                          marginBottom: 10,
                        }}
                      >
                        {b.inner === "general" ? "General" : `${prefix}-${b.inner}`}
                      </span>
                      {subTitle && (
                        <div style={{
                          fontSize: 14, fontWeight: 700, color: "var(--ink)",
                          marginBottom: 4, lineHeight: 1.35,
                        }}>
                          {subTitle}
                        </div>
                      )}
                      <div style={{ fontSize: 13, color: "var(--slate-600)", fontWeight: 600 }}>
                        {b.count} {b.count === 1 ? "pregunta" : "preguntas"}
                      </div>
                    </div>
                    <ArrowRight
                      className="h-4 w-4"
                      style={{ color: "var(--slate-400)", flexShrink: 0, marginTop: 2 }}
                    />
                  </div>
                </Link>
                )
              })}
            </div>
          </section>
        )}
      </div>
    )
  }

  // Generar test aleatorio del tema (cuando hay ?n=)
  const shuffled = shuffle(allQuestionIds)
  const selectedIds = shuffled.slice(0, requested).map((q) => q.id)

  const questions = await db.question.findMany({
    where:   { id: { in: selectedIds }, ...QUESTION_VISIBLE_WHERE },
    include: { options: { orderBy: { letra: "asc" } } },
  })

  const orderMap = new Map(selectedIds.map((id, i) => [id, i]))
  questions.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0))

  const data: TestRunnerData = {
    test: {
      id:             0,
      testNumber:     0,
      totalQuestions: questions.length,
      category: {
        slug: `tema-${prefix.replace(/\s+/g, "-").toLowerCase()}`,
        name: getTemaName(prefix),
        code: prefix,
      },
    },
    questions: questions.map((q) => ({
      id:         q.id,
      externalId: q.externalId,
      enunciado:  q.enunciado,
      imagen:     q.imagen,
      codigoTema: q.codigoTema,
      options:    q.options.map((o) => ({ id: o.id, letra: o.letra, texto: o.texto })),
      // Práctica por tema: siempre enviamos solución para feedback inline
      correctOptionId: q.options.find((o) => o.isCorrect)?.id ?? null,
      explicacion:     q.explicacion ?? null,
      aiGenerated:     q.aiGenerated,
    })),
  }

  return (
    <div className="space-y-4">
      <Link href={`/temas/${rawPrefix}`} className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1">
        <ChevronLeft className="h-4 w-4" />
        Volver al tema
      </Link>
      <div className="flex items-center gap-2 text-sm text-slate-700">
        <BookMarked className="h-4 w-4" />
        <span>Practicando {questions.length} preguntas del tema</span>
        <Badge variant="secondary" className="font-mono">{prefix}</Badge>
        <span className="text-slate-500">— {getTemaName(prefix)}</span>
      </div>
      <ExamRunner
        data={data}
        mode="tema"
        aiQuota={getEffectiveTokenQuota(user)}
        aiQuotaRemaining={(await getQuotaStatus(user.id)).remaining}
      />
    </div>
  )
}
