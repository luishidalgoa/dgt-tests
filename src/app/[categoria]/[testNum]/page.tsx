import { notFound } from "next/navigation"
import Link from "next/link"
import { db } from "@/lib/db"
import { ExamRunner } from "@/components/ExamRunner"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  ChevronLeft,
  BookOpen,
  Timer,
} from "lucide-react"
import type { TestRunnerData } from "@/types/exam"

const EXAM_DURATION_SECONDS = 30 * 60   // 30 minutos como en la DGT real

interface PageProps {
  params:       Promise<{ categoria: string; testNum: string }>
  searchParams: Promise<{ mode?: string }>
}

export default async function ExamPage({ params, searchParams }: PageProps) {
  const { categoria, testNum } = await params
  const sp = await searchParams
  const examMode = sp.mode === "examen"
  const testNumber = parseInt(testNum, 10)
  if (Number.isNaN(testNumber)) notFound()

  const test = await db.test.findFirst({
    where: {
      testNumber,
      category: { slug: categoria },
    },
    include: {
      category: true,
      testQuestions: {
        orderBy: { order: "asc" },
        include: {
          question: {
            include: {
              options: { orderBy: { letra: "asc" } },
            },
          },
        },
      },
    },
  })

  if (!test) notFound()

  // Pantalla de selección de modo
  if (!sp.mode) {
    return (
      <div className="space-y-6">
        <Link
          href={`/${categoria}`}
          className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" />
          Volver a {test.category.name}
        </Link>

        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="secondary">{test.category.code}</Badge>
            <span className="text-sm text-slate-500">{test.category.name}</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Test {test.testNumber}
          </h1>
          <p className="text-slate-600 mt-1">
            {test.testQuestions.length} preguntas
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="hover:shadow-md hover:border-slate-300 transition">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <BookOpen className="h-8 w-8 text-slate-700" />
                <div>
                  <h2 className="text-xl font-semibold">Modo práctica</h2>
                  <p className="text-sm text-slate-600">
                    Sin temporizador. Navega libremente y corrige cuando quieras.
                  </p>
                </div>
              </div>
              <Button asChild className="w-full">
                <Link href={`/${categoria}/${testNumber}?mode=practica`}>
                  Empezar práctica
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md hover:border-amber-200 transition">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <Timer className="h-8 w-8 text-amber-500" />
                <div>
                  <h2 className="text-xl font-semibold">Modo examen real</h2>
                  <p className="text-sm text-slate-600">
                    30 minutos. Simula las condiciones del examen oficial DGT.
                  </p>
                </div>
              </div>
              <Button asChild className="w-full bg-amber-500 hover:bg-amber-600">
                <Link href={`/${categoria}/${testNumber}?mode=examen`}>
                  Empezar examen
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  // Construir payload para el ExamRunner
  const data: TestRunnerData = {
    test: {
      id:             test.id,
      testNumber:     test.testNumber,
      totalQuestions: test.totalQuestions,
      category: {
        slug: test.category.slug,
        name: test.category.name,
        code: test.category.code,
      },
    },
    questions: test.testQuestions.map((tq) => ({
      id:         tq.question.id,
      externalId: tq.question.externalId,
      enunciado:  tq.question.enunciado,
      imagen:     tq.question.imagen,
      codigoTema: tq.question.codigoTema,
      options:    tq.question.options.map((o) => ({
        id:    o.id,
        letra: o.letra,
        texto: o.texto,
      })),
    })),
  }

  return (
    <div className="space-y-4">
      <Link
        href={`/${categoria}/${testNumber}`}
        className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
      >
        <ChevronLeft className="h-4 w-4" />
        Cambiar modo
      </Link>
      <ExamRunner
        data={data}
        timeLimit={examMode ? EXAM_DURATION_SECONDS : null}
      />
    </div>
  )
}
