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
import { Badge } from "@/components/ui/badge"
import {
  ChevronLeft,
  Lightbulb,
  Dumbbell,
  CheckCircle2,
  GraduationCap,
  Brain,
} from "lucide-react"
import type { TestRunnerData, AttemptMode } from "@/types/exam"

interface PageProps {
  searchParams: Promise<{ n?: string; modo?: string }>
}

/**
 * Modos de UI de /test-errores. Mapean a AttemptMode al persistir:
 *   "practica" → "errores"            (default; aciertos sacan del pool)
 *   "refuerzo" → "errores-refuerzo"   (aciertos NO sacan del pool;
 *                                      el histórico alimenta análisis IA)
 *
 * En ambos modos el ExamRunner se renderiza igual que el "modo práctica"
 * de los exámenes normales: sin temporizador, con feedback inline al
 * responder. La diferencia es solo lo que el backend hace con los
 * resultados.
 */
type ErroresUiMode = "practica" | "refuerzo"

function parseModo(raw: string | undefined): ErroresUiMode {
  return raw === "refuerzo" ? "refuerzo" : "practica"
}

function toAttemptMode(uiMode: ErroresUiMode): AttemptMode {
  return uiMode === "refuerzo" ? "errores-refuerzo" : "errores"
}

/** Construye href de /test-errores preservando el modo activo. */
function buildHref(params: { n?: number; modo: ErroresUiMode }): string {
  const q = new URLSearchParams()
  if (params.n !== undefined) q.set("n", String(params.n))
  if (params.modo === "refuerzo") q.set("modo", "refuerzo")
  const qs = q.toString()
  return qs ? `/test-errores?${qs}` : "/test-errores"
}

export default async function TestErroresPage({ searchParams }: PageProps) {
  const user = await requireUser()
  if (!hasFullAccess(user)) redirect("/upgrade")
  const sp = await searchParams
  const requested = sp.n ? Math.max(1, Math.min(parseInt(sp.n, 10), 100)) : null
  const modo: ErroresUiMode = parseModo(sp.modo)

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
              <Dumbbell className="h-12 w-12" style={{ color: "var(--amber)" }} />
            </div>

            {/* Selector de modo */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10, color: "var(--slate-700)" }}>
                ¿Cómo quieres entrenar?
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                <ModoCard
                  href={buildHref({ modo: "practica" })}
                  active={modo === "practica"}
                  icon={<GraduationCap className="h-5 w-5" />}
                  title="Modo práctica"
                  desc="Si aciertas un error, deja de estar pendiente. Limpia tu pool de fallos."
                />
                <ModoCard
                  href={buildHref({ modo: "refuerzo" })}
                  active={modo === "refuerzo"}
                  icon={<Brain className="h-5 w-5" />}
                  title="Modo refuerzo IA"
                  desc="Los fallos siguen marcados aunque hoy los aciertes. El análisis IA verá tus puntos débiles aunque hayas mejorado."
                />
              </div>
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
                      href={buildHref({ n: realN, modo })}
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
    // Ambos modos usan la MISMA forma de pintar el runner que el modo
    // práctica de los exámenes normales: correctOptionId + explicacion
    // → ExamRunner muestra feedback inline al responder.
    questions: questions.map((q) => ({
      id:              q.id,
      externalId:      q.externalId,
      enunciado:       q.enunciado,
      imagen:          q.imagen,
      codigoTema:      q.codigoTema,
      options:         q.options.map((o) => ({ id: o.id, letra: o.letra, texto: o.texto })),
      correctOptionId: q.options.find((o) => o.isCorrect)?.id ?? null,
      explicacion:     q.explicacion ?? null,
      aiGenerated:     q.aiGenerated,
    })),
  }

  const attemptMode = toAttemptMode(modo)

  return (
    <div className="space-y-4">
      <Link href={buildHref({ modo })} className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1">
        <ChevronLeft className="h-4 w-4" />
        Volver
      </Link>
      <div className="flex items-center gap-2 text-sm text-amber-700 flex-wrap">
        {modo === "refuerzo" ? (
          <>
            <Brain className="h-4 w-4" />
            <span>Modo refuerzo IA · {questions.length} errores recientes</span>
            <Badge variant="outline" className="text-amber-700 border-amber-200">
              los fallos siguen pendientes
            </Badge>
          </>
        ) : (
          <>
            <GraduationCap className="h-4 w-4" />
            <span>Modo práctica · {questions.length} errores recientes</span>
            <Badge variant="outline" className="text-amber-700 border-amber-200">
              aciertos limpian el pool
            </Badge>
          </>
        )}
      </div>
      <ExamRunner
        data={data}
        mode={attemptMode}
        aiQuota={getEffectiveTokenQuota(user)}
        aiQuotaRemaining={(await getQuotaStatus(user.id)).remaining}
      />
    </div>
  )
}

function ModoCard({ href, active, icon, title, desc }: {
  href:   string
  active: boolean
  icon:   React.ReactNode
  title:  string
  desc:   string
}) {
  return (
    <Link
      href={href}
      style={{
        display:        "block",
        padding:        "14px 16px",
        borderRadius:   12,
        border:         active ? "2px solid var(--amber)" : "2px solid var(--slate-200)",
        background:     active ? "rgba(245, 158, 11, 0.08)" : "#fff",
        textDecoration: "none",
        color:          "inherit",
        transition:     "background 120ms ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{
          color: active ? "var(--amber-d)" : "var(--slate-500)",
        }}>
          {icon}
        </span>
        <span style={{ fontWeight: 700, fontSize: 14, color: active ? "var(--ink)" : "var(--slate-700)" }}>
          {title}
        </span>
        {active && (
          <span style={{
            marginLeft:   "auto",
            padding:      "1px 7px",
            borderRadius: 999,
            background:   "var(--amber)",
            color:        "white",
            fontSize:     10,
            fontWeight:   800,
            letterSpacing: "0.04em",
          }}>
            ELEGIDO
          </span>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--slate-600)", lineHeight: 1.4 }}>
        {desc}
      </p>
    </Link>
  )
}
