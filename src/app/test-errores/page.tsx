import Link from "next/link"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { getPendingErrorQuestionIds } from "@/lib/errors"
import { QUESTION_VISIBLE_WHERE } from "@/lib/questions"
import { shuffle } from "@/lib/shuffle"
import { ExamRunner } from "@/components/ExamRunner"
import { hasFullAccess, getEffectiveTokenQuota } from "@/lib/permissions"
import { getQuotaStatus } from "@/lib/aiQuota"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  ChevronLeft,
  Lightbulb,
  Sparkles,
  CheckCircle2,
} from "lucide-react"
import type { TestRunnerData } from "@/types/exam"

interface PageProps {
  searchParams: Promise<{ n?: string }>
}

export default async function TestErroresPage({ searchParams }: PageProps) {
  const user = await requireUser()
  if (!hasFullAccess(user)) redirect("/upgrade")
  const sp = await searchParams
  const requested = sp.n ? Math.max(1, Math.min(parseInt(sp.n, 10), 100)) : null

  const errorIds = await getPendingErrorQuestionIds(user.id)
  const total = errorIds.length

  // Caso 1: no se ha pedido tamaño todavía → mostrar pantalla de selección
  if (!requested) {
    return (
      <div>
        <Link href="/" className="back-link">
          <ChevronLeft className="h-4 w-4" />
          Inicio
        </Link>

        <header className="page-header">
          <div>
            <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Lightbulb className="h-7 w-7" style={{ color: "var(--amber)" }} />
              Test de errores
            </h1>
            <p className="lead">
              Practica solo las preguntas que has fallado y no has vuelto a acertar.
            </p>
          </div>
        </header>

        {total === 0 ? (
          <div className="empty-state" style={{ borderColor: "rgba(34, 197, 94, 0.45)", color: "var(--green-d)" }}>
            <CheckCircle2 className="h-12 w-12 mx-auto" style={{ color: "var(--green)" }} />
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: "12px 0 6px", color: "var(--ink)" }}>
              ¡Sin errores pendientes!
            </h2>
            <p style={{ margin: "0 0 18px" }}>
              Haz algún test primero para que aparezcan tus fallos aquí.
            </p>
            <Link href="/" className="btn-primary" style={{ display: "inline-flex" }}>
              Ir a la página de inicio →
            </Link>
          </div>
        ) : (
          <div className="card-soft warm" style={{ padding: 28 }}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <div style={{ fontSize: 11.5, color: "var(--slate-500)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Errores pendientes
                </div>
                <div className="font-mono-tabular" style={{ fontSize: 52, fontWeight: 900, marginTop: 4, color: "var(--red-500)", letterSpacing: "-0.04em" }}>
                  {total}
                </div>
              </div>
              <Sparkles className="h-12 w-12" style={{ color: "var(--amber)" }} />
            </div>

            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10, color: "var(--slate-700)" }}>
                ¿Cuántas preguntas quieres practicar?
              </div>
              <div className="flex flex-wrap gap-2">
                {[10, 20, 30, total].map((n, i) => {
                  const realN = Math.min(n, total)
                  if (i > 0 && realN === Math.min([10, 20, 30][i - 1] ?? 0, total)) return null
                  const isAll = realN === total
                  return (
                    <Link
                      key={`${n}-${i}`}
                      href={`/test-errores?n=${realN}`}
                      className={isAll ? "btn-amber" : "btn-secondary"}
                    >
                      {isAll ? `Todas (${total})` : realN}
                    </Link>
                  )
                })}
              </div>
            </div>

            <p style={{ fontSize: 12, color: "var(--slate-500)", marginTop: 18, marginBottom: 0 }}>
              Las preguntas se seleccionan en orden aleatorio entre los errores recientes.
            </p>
          </div>
        )}
      </div>
    )
  }

  // Caso 2: se ha pedido un test → seleccionar preguntas y montar el runner
  if (total === 0) {
    return (
      <div className="empty-state" style={{ borderColor: "rgba(34, 197, 94, 0.45)" }}>
        <CheckCircle2 className="h-12 w-12 mx-auto" style={{ color: "var(--green)" }} />
        <h2 style={{ fontSize: 20, fontWeight: 800, margin: "12px 0", color: "var(--ink)" }}>
          Sin errores pendientes
        </h2>
      </div>
    )
  }

  // Mezclar y tomar las primeras N
  const shuffled = shuffle(errorIds)
  const selectedIds = shuffled.slice(0, Math.min(requested, total))

  const questions = await db.question.findMany({
    where:   { id: { in: selectedIds }, ...QUESTION_VISIBLE_WHERE },
    include: { options: { orderBy: { letra: "asc" } } },
  })

  // Mantener el orden mezclado
  const orderMap = new Map(selectedIds.map((id, i) => [id, i]))
  questions.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0))

  const data: TestRunnerData = {
    test: {
      id:             0,                    // sin test asociado real
      testNumber:     0,
      totalQuestions: questions.length,
      category:       { slug: "test-errores", name: "Test de errores", code: "ERR" },
    },
    questions: questions.map((q) => ({
      id:         q.id,
      externalId: q.externalId,
      enunciado:  q.enunciado,
      imagen:     q.imagen,
      codigoTema: q.codigoTema,
      options:    q.options.map((o) => ({ id: o.id, letra: o.letra, texto: o.texto })),
      // Modo errores: feedback inline al responder
      correctOptionId: q.options.find((o) => o.isCorrect)?.id ?? null,
      explicacion:     q.explicacion ?? null,
    })),
  }

  return (
    <div className="space-y-4">
      <Link href="/test-errores" className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1">
        <ChevronLeft className="h-4 w-4" />
        Volver
      </Link>
      <div className="flex items-center gap-2 text-sm text-amber-700">
        <Lightbulb className="h-4 w-4" />
        <span>Practicando {questions.length} errores recientes</span>
        <Badge variant="outline" className="text-amber-700 border-amber-200">
          modo errores
        </Badge>
      </div>
      <ExamRunner
        data={data}
        mode="errores"
        aiQuota={getEffectiveTokenQuota(user)}
        aiQuotaRemaining={(await getQuotaStatus(user.id)).remaining}
      />
    </div>
  )
}
