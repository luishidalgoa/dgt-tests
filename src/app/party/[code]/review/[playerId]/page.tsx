import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { db } from "@/lib/db"
import { getPartyMembership } from "@/lib/party-me"
import { imageUrl } from "@/lib/imageUrl"
import { scoreForAnswer } from "@/lib/party"
import { findManualSectionsForCodes } from "@/lib/manual"
import { ManualButton } from "@/components/ManualButton"
import {
  ChevronLeft,
  CheckCircle2,
  XCircle,
  Trophy,
  Clock,
  Zap,
  Target,
  Users,
} from "lucide-react"

export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ code: string; playerId: string }>
}

function formatMs(ms: number): string {
  const s = ms / 1000
  if (s < 10) return `${s.toFixed(1)}s`
  return `${Math.round(s)}s`
}

export default async function PartyReviewPage({ params }: PageProps) {
  const { code, playerId } = await params

  const party = await db.party.findUnique({
    where: { code },
    include: {
      players: {
        include: { user: true, answers: true },
        orderBy: { joinedAt: "asc" },
      },
    },
  })
  if (!party) notFound()

  // Solo miembros pueden ver reviews
  const me = await getPartyMembership(party.id)
  if (!me) redirect(`/party/${code}`)

  const targetId = parseInt(playerId, 10)
  if (Number.isNaN(targetId)) notFound()

  const target = party.players.find((p) => p.id === targetId)
  if (!target) notFound()

  const targetName = target.user
    ? (target.user.displayName ?? target.user.username)
    : (target.guestName ?? "Anónimo")

  // Cargar preguntas (en el orden de la party)
  const questionIds: number[] = JSON.parse(party.questionIds)
  const questions = await db.question.findMany({
    where:   { id: { in: questionIds } },
    include: { options: { orderBy: { letra: "asc" } } },
  })
  const orderMap = new Map(questionIds.map((id, i) => [id, i]))
  questions.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0))

  // Respuestas indexadas por questionId
  const answersByQ = new Map(target.answers.map((a) => [a.questionId, a]))

  // Stats del jugador
  const totalScore   = target.answers.reduce((acc, a) => acc + scoreForAnswer(a.isCorrect, a.timeMs), 0)
  const correctCount = target.answers.filter((a) => a.isCorrect).length
  const wrongCount   = target.answers.filter((a) => !a.isCorrect && a.selectedOptionId !== null).length
  const blanks       = target.answers.filter((a) => a.selectedOptionId === null).length
  const unanswered   = questions.length - target.answers.length

  // Cargar manual relacionado
  const codigos = questions.map((q) => q.codigoTema)
  const manualByCodigo = await findManualSectionsForCodes(codigos)

  return (
    <div>
      <Link href={`/party/${code}/results`} className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Resultados
      </Link>

      <header className="page-header">
        <div>
          <div style={{ fontSize: 12, color: "var(--slate-500)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Revisión de
          </div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 40, height: 40, borderRadius: "50%",
                background: target.id === me.id
                  ? "linear-gradient(135deg, var(--orange-500), var(--red-600))"
                  : "linear-gradient(135deg, #94a3b8, #475569)",
                color: "#fff", fontWeight: 800, fontSize: 16,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {targetName[0]?.toUpperCase()}
            </div>
            {targetName}
            {target.id === me.id && (
              <span style={{ fontSize: 13, color: "var(--orange-600)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                (tú)
              </span>
            )}
          </h1>
        </div>
      </header>

      {/* Resumen */}
      <div className="card-soft warm" style={{ padding: 24, marginBottom: 22 }}>
        <div className="flex flex-wrap gap-6 justify-between items-center">
          <div className="flex items-center gap-3">
            <Trophy className="h-10 w-10" style={{ color: "var(--amber)" }} />
            <div>
              <div className="font-mono-tabular" style={{ fontSize: 36, fontWeight: 900, color: "var(--orange-600)", letterSpacing: "-0.03em" }}>
                {totalScore}
              </div>
              <div style={{ fontSize: 11, color: "var(--slate-500)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Puntos totales
              </div>
            </div>
          </div>

          <div className="flex gap-5 text-center">
            <Stat label="Aciertos" value={correctCount} color="var(--green)"   icon={<CheckCircle2 className="h-4 w-4" />} />
            <Stat label="Fallos"   value={wrongCount}   color="var(--red-500)" icon={<XCircle className="h-4 w-4" />} />
            {blanks > 0 && (
              <Stat label="Blancos"     value={blanks}     color="var(--slate-400)" />
            )}
            {unanswered > 0 && (
              <Stat label="No vistas"   value={unanswered} color="var(--slate-400)" />
            )}
          </div>
        </div>
      </div>

      {/* Cambiar de jugador */}
      <div className="dash-section-title" style={{ margin: "0 4px 14px" }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Users className="h-5 w-5" />
          Ver respuestas de otro jugador
        </h3>
      </div>
      <div className="flex flex-wrap gap-2 mb-8">
        {party.players.map((p) => {
          const name = p.user ? (p.user.displayName ?? p.user.username) : (p.guestName ?? "Anónimo")
          const isCurrent = p.id === target.id
          return (
            <Link
              key={p.id}
              href={`/party/${code}/review/${p.id}`}
              className={isCurrent ? "btn-primary" : "btn-secondary"}
            >
              {name}
            </Link>
          )
        })}
      </div>

      {/* Detalle pregunta a pregunta */}
      <div className="dash-section-title" style={{ margin: "0 4px 14px" }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Target className="h-5 w-5" />
          Revisión pregunta a pregunta
        </h3>
      </div>

      <div className="space-y-3">
        {questions.map((q, idx) => {
          const answer = answersByQ.get(q.id)
          const isCorrect = answer?.isCorrect ?? false
          const isBlank = answer ? answer.selectedOptionId === null : false
          const points = answer ? scoreForAnswer(answer.isCorrect, answer.timeMs) : 0
          const manualSection = q.codigoTema ? manualByCodigo.get(q.codigoTema) : null

          let borderColor = "var(--slate-200)"
          if (answer) {
            if (isCorrect) borderColor = "rgba(34, 197, 94, 0.45)"
            else if (isBlank) borderColor = "var(--slate-300)"
            else borderColor = "rgba(239, 68, 68, 0.40)"
          }

          return (
            <div
              key={q.id}
              className="card-soft"
              style={{ padding: 20, borderColor }}
            >
              <div className="grid gap-4 md:grid-cols-[200px_1fr]">
                {/* Imagen */}
                <div>
                  {q.imagen ? (
                    <div className="relative aspect-square rounded-xl overflow-hidden" style={{ background: "var(--slate-100)" }}>
                      <Image
                        src={imageUrl(q.imagen)}
                        alt={`Pregunta ${idx + 1}`}
                        fill
                        className="object-contain"
                        sizes="200px"
                      />
                    </div>
                  ) : (
                    <div className="aspect-square rounded-xl flex items-center justify-center text-xs" style={{ background: "var(--slate-100)", color: "var(--slate-300)" }}>
                      sin imagen
                    </div>
                  )}
                  {q.codigoTema && (
                    <div className="font-mono-tabular text-center mt-2" style={{ fontSize: 11, color: "var(--slate-500)" }}>
                      {q.codigoTema}
                    </div>
                  )}
                </div>

                {/* Texto + opciones */}
                <div>
                  <div className="flex items-start gap-3 mb-3">
                    <span
                      className="font-mono-tabular flex-shrink-0"
                      style={{
                        background: isCorrect
                          ? "linear-gradient(180deg, var(--green), var(--green-d))"
                          : isBlank
                          ? "linear-gradient(180deg, var(--slate-300), var(--slate-400))"
                          : answer
                          ? "linear-gradient(180deg, var(--red-500), var(--red-600))"
                          : "linear-gradient(180deg, var(--slate-300), var(--slate-400))",
                        color: "#fff",
                        fontWeight: 800,
                        fontSize: 13,
                        padding: "4px 10px",
                        borderRadius: 8,
                        marginTop: 2,
                      }}
                    >
                      {idx + 1}
                    </span>
                    {answer && (isCorrect ? (
                      <CheckCircle2 className="h-5 w-5 flex-shrink-0 mt-1" style={{ color: "var(--green)" }} />
                    ) : isBlank ? (
                      <XCircle className="h-5 w-5 flex-shrink-0 mt-1" style={{ color: "var(--slate-400)" }} />
                    ) : (
                      <XCircle className="h-5 w-5 flex-shrink-0 mt-1" style={{ color: "var(--red-500)" }} />
                    ))}
                    <h3 className="font-semibold leading-snug m-0 flex-1" style={{ fontSize: 15 }}>
                      {q.enunciado}
                    </h3>
                    {answer && (
                      <div className="flex items-center gap-3 flex-shrink-0" style={{ fontSize: 12 }}>
                        <span className="flex items-center gap-1" style={{ color: "var(--slate-500)" }}>
                          <Clock className="h-3.5 w-3.5" />
                          {formatMs(answer.timeMs)}
                        </span>
                        <span className="flex items-center gap-1 font-mono-tabular" style={{ color: "var(--orange-600)", fontWeight: 800 }}>
                          <Zap className="h-3.5 w-3.5" />
                          {points}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Opciones */}
                  <div className="space-y-1.5">
                    {q.options.map((opt) => {
                      const isSelectedByPlayer = answer?.selectedOptionId === opt.id
                      const isTheCorrect = opt.isCorrect
                      let bg = "#fff"
                      let border = "var(--slate-200)"
                      if (isTheCorrect) {
                        bg = "rgba(34, 197, 94, 0.08)"
                        border = "rgba(34, 197, 94, 0.45)"
                      } else if (isSelectedByPlayer) {
                        bg = "rgba(239, 68, 68, 0.08)"
                        border = "rgba(239, 68, 68, 0.40)"
                      }
                      return (
                        <div
                          key={opt.id}
                          className="flex items-center gap-2"
                          style={{
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: `1.5px solid ${border}`,
                            background: bg,
                            fontSize: 14,
                          }}
                        >
                          <span
                            className="flex-shrink-0 flex items-center justify-center font-bold"
                            style={{
                              width: 26, height: 26, borderRadius: "50%", fontSize: 12,
                              background: isTheCorrect
                                ? "var(--green)"
                                : isSelectedByPlayer
                                ? "var(--red-500)"
                                : "transparent",
                              color: (isTheCorrect || isSelectedByPlayer) ? "#fff" : "var(--slate-500)",
                              border: (isTheCorrect || isSelectedByPlayer) ? "0" : "1.5px solid var(--slate-300)",
                            }}
                          >
                            {opt.letra}
                          </span>
                          <span className="flex-1">{opt.texto}</span>
                          {isTheCorrect && (
                            <span style={{ fontSize: 10, fontWeight: 800, color: "var(--green-d)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                              correcta
                            </span>
                          )}
                          {isSelectedByPlayer && !isTheCorrect && (
                            <span style={{ fontSize: 10, fontWeight: 800, color: "var(--red-600)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                              su respuesta
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Manual + Explicación */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {manualSection && <ManualButton section={manualSection} />}
                  </div>
                  {q.explicacion && (
                    <details className="mt-2">
                      <summary
                        style={{
                          cursor: "pointer",
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--slate-700)",
                          padding: "6px 0",
                        }}
                      >
                        Ver explicación
                      </summary>
                      <div
                        style={{
                          marginTop: 8,
                          padding: 12,
                          borderRadius: 8,
                          background: "var(--slate-100)",
                          fontSize: 13,
                          color: "var(--slate-700)",
                          whiteSpace: "pre-wrap",
                          lineHeight: 1.5,
                        }}
                      >
                        {q.explicacion}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}


function Stat({ label, value, color, icon }: { label: string; value: number; color: string; icon?: React.ReactNode }) {
  return (
    <div>
      <div
        className="font-mono-tabular flex items-center gap-1 justify-center"
        style={{ fontSize: 24, fontWeight: 800, color }}
      >
        {icon}
        {value}
      </div>
      <div style={{ fontSize: 10.5, color: "var(--slate-500)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
    </div>
  )
}
