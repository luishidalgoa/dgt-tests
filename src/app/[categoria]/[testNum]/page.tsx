import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { ExamRunner } from "@/components/ExamRunner"
import {
  ChevronLeft,
  BookOpen,
  Timer,
  History,
  Trophy,
  RotateCw,
  Lock,
} from "lucide-react"
import type { TestRunnerData } from "@/types/exam"

export const dynamic = "force-dynamic"

const PASS_THRESHOLD = 0.9

const EXAM_DURATION_SECONDS = 30 * 60   // 30 minutos como en la DGT real

interface PageProps {
  params:       Promise<{ categoria: string; testNum: string }>
  searchParams: Promise<{ mode?: string }>
}

export default async function ExamPage({ params, searchParams }: PageProps) {
  const user = await getCurrentUser()
  const { categoria, testNum } = await params
  const sp = await searchParams
  const examMode = sp.mode === "examen"
  const testNumber = parseInt(testNum, 10)
  if (Number.isNaN(testNumber)) notFound()

  // Bloquear modo examen para invitados
  if (examMode && !user) {
    redirect(`/login?redirect=/${categoria}/${testNumber}?mode=examen`)
  }

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
    // Cargar intentos previos del usuario para ESTE test (solo si está logueado)
    const pastAttempts = user
      ? await db.examAttempt.findMany({
          where: {
            userId:     user.id,
            testId:     test.id,
            finishedAt: { not: null },
          },
          orderBy: { startedAt: "desc" },
          take:    20,
          select:  {
            id:        true,
            score:     true,
            total:     true,
            startedAt: true,
            mode:      true,
          },
        })
      : []

    return (
      <div>
        <Link href={`/${categoria}`} className="back-link">
          <ChevronLeft className="h-4 w-4" />
          Volver a {test.category.name}
        </Link>

        <header className="page-header">
          <div>
            <h1>Test {test.testNumber}</h1>
            <p className="lead">
              {test.category.name} · {test.testQuestions.length} preguntas
            </p>
          </div>
          <span className="badge">[{test.category.code}]</span>
        </header>

        <div className="grid gap-4 md:grid-cols-2 mb-6">
          <div className="card-soft" style={{ padding: 26 }}>
            <div className="flex items-center gap-3 mb-4">
              <div
                className="flex items-center justify-center rounded-xl"
                style={{
                  width: 52,
                  height: 52,
                  background: "linear-gradient(135deg, #0ea5e9, #0284c7)",
                  color: "#fff",
                  boxShadow: "0 8px 18px -10px rgba(2, 132, 199, 0.6)",
                }}
              >
                <BookOpen className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-extrabold m-0">Modo práctica</h2>
                <p className="text-sm m-0" style={{ color: "var(--slate-500)" }}>
                  Sin tiempo. Navega libre.
                </p>
              </div>
            </div>
            <Link
              href={`/${categoria}/${testNumber}?mode=practica`}
              className="btn-secondary w-full"
              style={{ width: "100%" }}
            >
              Empezar práctica →
            </Link>
          </div>

          {user ? (
            <div className="card-soft warm" style={{ padding: 26 }}>
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="flex items-center justify-center rounded-xl"
                  style={{
                    width: 52,
                    height: 52,
                    background: "linear-gradient(135deg, var(--amber), var(--red-500))",
                    color: "#fff",
                    boxShadow: "0 8px 18px -10px rgba(239, 68, 68, 0.5)",
                  }}
                >
                  <Timer className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold m-0">Examen real</h2>
                  <p className="text-sm m-0" style={{ color: "var(--slate-500)" }}>
                    30 min · simula la DGT
                  </p>
                </div>
              </div>
              <Link
                href={`/${categoria}/${testNumber}?mode=examen`}
                className="btn-amber"
                style={{ width: "100%" }}
              >
                Empezar examen
              </Link>
            </div>
          ) : (
            <div
              className="card-soft"
              style={{
                padding: 26,
                opacity: 0.85,
                border: "1.5px dashed var(--slate-300)",
                background: "rgba(148, 163, 184, 0.06)",
              }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="flex items-center justify-center rounded-xl"
                  style={{
                    width: 52,
                    height: 52,
                    background: "var(--slate-200)",
                    color: "var(--slate-500)",
                  }}
                >
                  <Lock className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold m-0">Examen real</h2>
                  <p className="text-sm m-0" style={{ color: "var(--slate-500)" }}>
                    Solo para usuarios registrados
                  </p>
                </div>
              </div>
              <Link
                href={`/login?redirect=/${categoria}/${testNumber}?mode=examen`}
                className="btn-secondary"
                style={{ width: "100%" }}
              >
                Iniciar sesión para acceder
              </Link>
            </div>
          )}
        </div>

        {/* Intentos previos */}
        {user && pastAttempts.length > 0 && (
          <section>
            <div className="dash-section-title" style={{ margin: "8px 4px 14px" }}>
              <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <History className="h-5 w-5" />
                Tus intentos en este test
                <span className="badge" style={{ marginLeft: 6, padding: "3px 9px", fontSize: 12 }}>
                  {pastAttempts.length}
                </span>
              </h3>
            </div>
            <div className="card-soft" style={{ padding: 8 }}>
              {pastAttempts.map((a) => {
                const score  = a.score ?? 0
                const passed = score / a.total >= PASS_THRESHOLD
                return (
                  <Link
                    key={a.id}
                    href={`/${categoria}/${testNumber}/resultado/${a.id}`}
                    className="dash-row-item"
                  >
                    <span
                      className="dash-light"
                      aria-hidden="true"
                      style={{
                        background: passed ? "var(--green)" : score / a.total >= 0.7 ? "var(--amber)" : "var(--red-500)",
                        boxShadow: passed
                          ? "0 0 0 4px rgba(34,197,94,0.18)"
                          : score / a.total >= 0.7
                          ? "0 0 0 4px rgba(245,158,11,0.18)"
                          : "0 0 0 4px rgba(239,68,68,0.18)",
                      }}
                    />
                    <div className="dash-row-title">
                      {passed ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <Trophy className="h-4 w-4" style={{ color: "var(--green)" }} />
                          {a.startedAt.toLocaleString("es-ES")}
                        </span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <RotateCw className="h-4 w-4" style={{ color: "var(--amber)" }} />
                          {a.startedAt.toLocaleString("es-ES")}
                        </span>
                      )}
                      <small>{a.mode === "examen" ? "Examen real" : "Práctica"}</small>
                    </div>
                    <div className="dash-score">{score}/{a.total}</div>
                    <div className="dash-ts">{Math.round((score / a.total) * 100)}%</div>
                  </Link>
                )
              })}
            </div>
          </section>
        )}
      </div>
    )
  }

  // Construir payload para el ExamRunner
  // Para invitados, las soluciones son necesarias porque no hay POST al servidor.
  // Para usuarios logueados en modo práctica (no examen), las enviamos también
  // para poder mostrar feedback inline al responder.
  const isGuest = !user
  const sendSolutions = isGuest || !examMode

  // Cargar opciones con isCorrect y la explicación cuando hace falta
  const questionsWithSolutions = sendSolutions
    ? await db.question.findMany({
        where: { id: { in: test.testQuestions.map((tq) => tq.question.id) } },
        select: {
          id: true,
          explicacion: true,
          options: {
            select: { id: true, isCorrect: true },
          },
        },
      })
    : []

  const solutionsMap = new Map(
    questionsWithSolutions.map((q) => [
      q.id,
      {
        correctOptionId: q.options.find((o) => o.isCorrect)?.id ?? null,
        explicacion:     q.explicacion ?? null,
      },
    ])
  )

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
      correctOptionId: sendSolutions ? solutionsMap.get(tq.question.id)?.correctOptionId ?? null : undefined,
      explicacion:     sendSolutions ? solutionsMap.get(tq.question.id)?.explicacion ?? null : undefined,
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
        isGuest={isGuest}
      />
    </div>
  )
}
