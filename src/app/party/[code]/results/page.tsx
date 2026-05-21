import Link from "next/link"
import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { scoreForAnswer } from "@/lib/party"
import {
  Trophy,
  ChevronLeft,
  Medal,
  Zap,
  Target,
  Swords,
} from "lucide-react"

export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ code: string }>
}

const PODIUM_COLORS = [
  "linear-gradient(135deg, #fbbf24, #d97706)",   // oro
  "linear-gradient(135deg, #cbd5e1, #64748b)",   // plata
  "linear-gradient(135deg, #fb923c, #c2410c)",   // bronce
  "linear-gradient(135deg, #94a3b8, #475569)",   // resto
]

export default async function PartyResultsPage({ params }: PageProps) {
  const { code } = await params
  const party = await db.party.findUnique({
    where: { code },
    include: {
      category: true,
      players: {
        include: {
          user:    true,
          answers: { select: { isCorrect: true, timeMs: true } },
        },
      },
    },
  })
  if (!party) notFound()

  const players = party.players.map((p) => {
    const name = p.user ? (p.user.displayName ?? p.user.username) : (p.guestName ?? "Anónimo")
    const score = p.answers.reduce((acc, a) => acc + scoreForAnswer(a.isCorrect, a.timeMs), 0)
    const correct = p.answers.filter((a) => a.isCorrect).length
    const total   = p.answers.length
    const avgTime = total > 0
      ? Math.round(p.answers.reduce((acc, a) => acc + a.timeMs, 0) / total / 1000)
      : 0
    return { id: p.id, name, score, correct, total, avgTime, isHost: p.userId === party.hostUserId }
  }).sort((a, b) => b.score - a.score)

  const winner = players[0]

  return (
    <div>
      <Link href="/competir" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Modo competición
      </Link>

      <header className="page-header">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Trophy className="h-7 w-7" style={{ color: "var(--amber)" }} />
            Resultados
          </h1>
          <p className="lead">
            Party <span className="font-mono-tabular" style={{ color: "var(--orange-600)", fontWeight: 700 }}>{code}</span>
            {" · "}{party.totalQuestions} preguntas
            {party.category && ` · ${party.category.name}`}
          </p>
        </div>
      </header>

      {/* Hero ganador */}
      {winner && (
        <div className="card-soft warm" style={{ padding: 32, textAlign: "center", marginBottom: 22 }}>
          <Medal className="h-12 w-12 mx-auto" style={{ color: "var(--amber)" }} />
          <div style={{ fontSize: 11, color: "var(--slate-500)", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 8 }}>
            🏆 Ganador
          </div>
          <h2 style={{ fontSize: 36, fontWeight: 900, margin: "8px 0 4px", letterSpacing: "-0.02em" }}>
            {winner.name}
          </h2>
          <div className="font-mono-tabular" style={{ fontSize: 48, fontWeight: 900, color: "var(--orange-600)", letterSpacing: "-0.03em" }}>
            {winner.score} pts
          </div>
          <div style={{ color: "var(--slate-500)", fontSize: 14, marginTop: 4 }}>
            {winner.correct}/{winner.total} aciertos · ⌀ {winner.avgTime}s por pregunta
          </div>
        </div>
      )}

      {/* Tabla */}
      <div className="card-soft" style={{ padding: 8, marginBottom: 16 }}>
        {players.map((p, i) => (
          <div key={p.id} className="dash-row-item" style={{ gridTemplateColumns: "32px 1fr auto auto auto" }}>
            <span style={{
              width: 28, height: 28, borderRadius: "50%",
              background: PODIUM_COLORS[Math.min(i, 3)],
              color: "#fff", fontSize: 13, fontWeight: 800,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {i + 1}
            </span>
            <div className="dash-row-title">
              {p.name}{p.isHost && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--orange-600)", fontWeight: 700 }}>HOST</span>}
              <small>
                <Target className="h-3 w-3 inline mr-1" />
                {p.correct}/{p.total}
                {" · "}
                ⌀ {p.avgTime}s
              </small>
            </div>
            <div className="hidden md:block" style={{ fontSize: 13, color: "var(--slate-500)" }}>
              {Math.round((p.correct / p.total) * 100)}%
            </div>
            <div className="font-mono-tabular flex items-center gap-1" style={{ fontSize: 18, fontWeight: 800, color: "var(--orange-600)" }}>
              <Zap className="h-4 w-4" />
              {p.score}
            </div>
            <span />
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Link href="/competir/nueva" className="btn-primary" style={{ flex: 1 }}>
          <Swords className="h-4 w-4" />
          Otra party
        </Link>
        <Link href="/competir" className="btn-secondary" style={{ flex: 1 }}>
          Mis partys
        </Link>
      </div>
    </div>
  )
}
