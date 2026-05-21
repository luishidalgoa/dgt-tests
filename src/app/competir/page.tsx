import Link from "next/link"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { Swords, ChevronLeft, Plus, Users, Trophy, ArrowRight } from "lucide-react"

export const dynamic = "force-dynamic"

export default async function CompetirPage() {
  const user = await requireUser()

  const myRecent = await db.party.findMany({
    where: {
      OR: [
        { hostUserId: user.id },
        { players: { some: { userId: user.id } } },
      ],
    },
    include: {
      players: {
        select: { id: true, finishedAt: true, userId: true, guestName: true, user: { select: { username: true, displayName: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  })

  return (
    <div>
      <Link href="/" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Inicio
      </Link>

      <header className="page-header">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Swords className="h-7 w-7" style={{ color: "var(--red-600)" }} />
            Modo competición
          </h1>
          <p className="lead">
            Crea una party privada de hasta 4 jugadores y compite por velocidad y acierto.
          </p>
        </div>
        <Link href="/competir/nueva" className="btn-primary">
          <Plus className="h-4 w-4" />
          Crear party
        </Link>
      </header>

      {myRecent.length === 0 ? (
        <div className="empty-state">
          <span className="ico">🏁</span>
          Todavía no has creado ni te has unido a ninguna party.<br />
          <Link href="/competir/nueva" className="btn-primary" style={{ marginTop: 18, display: "inline-flex" }}>
            <Plus className="h-4 w-4" />
            Crear mi primera party
          </Link>
        </div>
      ) : (
        <div className="card-soft" style={{ padding: 8 }}>
          {myRecent.map((p) => {
            const totalPlayers = p.players.length
            const finished     = p.players.filter((pl) => pl.finishedAt !== null).length
            return (
              <Link key={p.id} href={`/party/${p.code}`} className="dash-row-item">
                <Users className="h-5 w-5" style={{ color: "var(--orange-600)" }} />
                <div className="dash-row-title">
                  <span className="font-mono-tabular" style={{ marginRight: 8, color: "var(--orange-600)" }}>
                    {p.code}
                  </span>
                  Party · {p.totalQuestions} preguntas
                  <small>
                    {p.status === "waiting" && `Esperando jugadores (${totalPlayers}/4)`}
                    {p.status === "playing"  && `Jugando · ${finished}/${totalPlayers} terminados`}
                    {p.status === "finished" && (
                      <>
                        <Trophy className="h-3 w-3 inline mr-1" style={{ color: "var(--green)" }} />
                        Finalizada
                      </>
                    )}
                  </small>
                </div>
                <div className="dash-score">{totalPlayers}/4</div>
                <ArrowRight className="h-4 w-4" style={{ color: "var(--slate-400)" }} />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
