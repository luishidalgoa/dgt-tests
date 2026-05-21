import Link from "next/link"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { getPendingErrorQuestionIds } from "@/lib/errors"
import { ExamRunner } from "@/components/ExamRunner"
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
  const sp = await searchParams
  const requested = sp.n ? Math.max(1, Math.min(parseInt(sp.n, 10), 100)) : null

  const errorIds = await getPendingErrorQuestionIds(user.id)
  const total = errorIds.length

  // Caso 1: no se ha pedido tamaño todavía → mostrar pantalla de selección
  if (!requested) {
    return (
      <div className="space-y-6">
        <Link href="/" className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1">
          <ChevronLeft className="h-4 w-4" />
          Inicio
        </Link>

        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Lightbulb className="h-7 w-7 text-amber-500" />
            Test de errores
          </h1>
          <p className="text-slate-600 mt-1">
            Practica solo las preguntas que has fallado y no has vuelto a acertar.
          </p>
        </div>

        {total === 0 ? (
          <Card className="border-emerald-200 bg-emerald-50/30">
            <CardContent className="p-10 text-center space-y-3">
              <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
              <h2 className="text-xl font-semibold">¡Sin errores pendientes!</h2>
              <p className="text-slate-600">
                Haz algún test primero para que aparezcan tus fallos aquí.
              </p>
              <Button asChild>
                <Link href="/">Ir a la página de inicio</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-500">Errores pendientes</div>
                  <div className="text-4xl font-bold mt-1">{total}</div>
                </div>
                <Sparkles className="h-10 w-10 text-amber-400" />
              </div>

              <div>
                <div className="text-sm font-medium mb-2">
                  ¿Cuántas preguntas quieres practicar?
                </div>
                <div className="flex flex-wrap gap-2">
                  {[10, 20, 30, total].map((n, i) => {
                    const realN = Math.min(n, total)
                    if (i > 0 && realN === Math.min([10, 20, 30][i - 1] ?? 0, total)) return null
                    return (
                      <Button
                        key={`${n}-${i}`}
                        variant="outline"
                        asChild
                      >
                        <Link href={`/test-errores?n=${realN}`}>
                          {realN === total ? `Todas (${total})` : realN}
                        </Link>
                      </Button>
                    )
                  })}
                </div>
              </div>

              <p className="text-xs text-slate-500">
                Las preguntas se seleccionan en orden aleatorio entre los errores recientes.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  // Caso 2: se ha pedido un test → seleccionar preguntas y montar el runner
  if (total === 0) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/30">
        <CardContent className="p-10 text-center">
          <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
          <h2 className="text-xl font-semibold mt-3">Sin errores pendientes</h2>
        </CardContent>
      </Card>
    )
  }

  // Mezclar y tomar las primeras N
  const shuffled = [...errorIds].sort(() => Math.random() - 0.5)
  const selectedIds = shuffled.slice(0, Math.min(requested, total))

  const questions = await db.question.findMany({
    where: { id: { in: selectedIds } },
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
      <ExamRunner data={data} mode="errores" />
    </div>
  )
}
