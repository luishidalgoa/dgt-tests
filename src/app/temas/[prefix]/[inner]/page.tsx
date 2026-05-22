import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import {
  getTemaName,
  extractTemaPrefix,
  extractTemaInner,
} from "@/lib/temas"
import { Prisma } from "@prisma/client"
import { shuffle } from "@/lib/shuffle"
import { QUESTION_VISIBLE_WHERE, SQL_QUESTION_VISIBLE_AND } from "@/lib/questions"
import { getSubBloqueInfo } from "@/lib/manualIndice"
import { ExamRunner } from "@/components/ExamRunner"
import { getEffectiveTokenQuota, hasFullAccess } from "@/lib/permissions"
import { getQuotaStatus } from "@/lib/aiQuota"
import { Badge } from "@/components/ui/badge"
import { ChevronLeft, BookMarked, Sparkles } from "lucide-react"
import type { TestRunnerData } from "@/types/exam"

export const dynamic = "force-dynamic"

interface PageProps {
  params:       Promise<{ prefix: string; inner: string }>
  searchParams: Promise<{ n?: string }>
}

/**
 * Test de un sub-bloque concreto dentro de un subtema grande.
 *
 * URL: /temas/TC%201.2/5.3       → todas las preguntas de "TC 1.2-5.3"
 *      /temas/TC%201.2/5.3?n=10  → lanza un test de 10 aleatorias
 *      /temas/TC%201.2/general   → preguntas sin guion estructural ("TC 1.2 (…)")
 *
 * El padre /temas/[prefix] decide cuándo enseñar sub-bloques; aquí solo
 * sirvo la vista de un bloque concreto. Reutilizo la misma UI del selector
 * que el padre usa para subtemas pequeños.
 */
export default async function InnerBlockPage({ params, searchParams }: PageProps) {
  const user = await getCurrentUser()
  if (!user) redirect("/")
  if (!hasFullAccess(user)) redirect("/upgrade")

  const { prefix: rawPrefix, inner: rawInner } = await params
  const sp = await searchParams
  const prefix    = decodeURIComponent(rawPrefix)
  const innerCode = decodeURIComponent(rawInner)
  const requested = sp.n ? Math.max(1, Math.min(parseInt(sp.n, 10), 200)) : null

  // Recuperamos todas las preguntas con codigoTema y filtramos en JS.
  // Mismo enfoque que el padre — captura los casos sin guion estructural.
  const all = await db.$queryRaw<{ id: number; codigoTema: string }[]>`
    SELECT id, codigoTema FROM questions q WHERE codigoTema IS NOT NULL ${Prisma.raw(SQL_QUESTION_VISIBLE_AND)}
  `
  const matched = all.filter((q) => {
    if (extractTemaPrefix(q.codigoTema) !== prefix) return false
    const inner = extractTemaInner(q.codigoTema) ?? "general"
    return inner === innerCode
  })

  const allQuestionIds = matched.map((q) => ({ id: q.id }))
  const totalAvailable = allQuestionIds.length

  if (totalAvailable === 0) notFound()

  const innerLabel = innerCode === "general" ? "General" : `${prefix}-${innerCode}`
  // Título legible del sub-bloque (si está en manualIndice.json).
  // Sub-bloque code jerárquico: prefix sin "TC " + "." + innerCode.
  const subCode = innerCode === "general"
    ? null
    : `${prefix.replace(/^TC\s+/, "")}.${innerCode}`
  const subInfo = subCode ? getSubBloqueInfo(subCode) : null

  // Vista selector (sin ?n=)
  if (!requested) {
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

    const options = [10, 20, 30, totalAvailable].filter(
      (n, i, arr) => n <= totalAvailable && arr.indexOf(n) === i
    )

    return (
      <div>
        <Link href={`/temas/${rawPrefix}`} className="back-link">
          <ChevronLeft className="h-4 w-4" />
          Volver a {getTemaName(prefix)}
        </Link>

        <header className="page-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
              <BookMarked className="h-6 w-6" style={{ color: "var(--orange-600)" }} />
              <span className="badge">{innerLabel}</span>
              <span style={{ fontSize: 12, color: "var(--slate-500)" }}>
                · {getTemaName(prefix)}
              </span>
            </div>
            <h1>{subInfo?.titulo ?? (innerCode === "general" ? "General" : `Sub-bloque ${innerCode}`)}</h1>
          </div>
        </header>

        <div className="card-soft warm" style={{ padding: 28, marginBottom: 6 }}>
          <div className="flex items-center justify-between gap-6 flex-wrap mb-6">
            <div>
              <div style={{ fontSize: 11.5, color: "var(--slate-500)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Preguntas en este bloque
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

          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10, color: "var(--slate-700)" }}>
              ¿Cuántas preguntas quieres practicar?
            </div>
            <div className="flex flex-wrap gap-2">
              {options.map((n) => (
                <Link
                  key={n}
                  href={`/temas/${rawPrefix}/${rawInner}?n=${n}`}
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
        </div>
      </div>
    )
  }

  // Generar test aleatorio del sub-bloque
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
        slug: `tema-${prefix.replace(/\s+/g, "-").toLowerCase()}-${innerCode}`,
        name: `${getTemaName(prefix)} · ${innerLabel}`,
        code: `${prefix}-${innerCode}`,
      },
    },
    questions: questions.map((q) => ({
      id:         q.id,
      externalId: q.externalId,
      enunciado:  q.enunciado,
      imagen:     q.imagen,
      codigoTema: q.codigoTema,
      options:    q.options.map((o) => ({ id: o.id, letra: o.letra, texto: o.texto })),
      correctOptionId: q.options.find((o) => o.isCorrect)?.id ?? null,
      explicacion:     q.explicacion ?? null,
    })),
  }

  return (
    <div className="space-y-4">
      <Link href={`/temas/${rawPrefix}/${rawInner}`} className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1">
        <ChevronLeft className="h-4 w-4" />
        Volver al sub-bloque
      </Link>
      <div className="flex items-center gap-2 text-sm text-slate-700 flex-wrap">
        <BookMarked className="h-4 w-4" />
        <span>Practicando {questions.length} preguntas de</span>
        <Badge variant="secondary" className="font-mono">{innerLabel}</Badge>
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
