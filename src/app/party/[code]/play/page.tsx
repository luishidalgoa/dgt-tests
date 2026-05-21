import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { PartyRunner } from "@/components/PartyRunner"
import { getPartyMembership } from "@/lib/party-me"

export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ code: string }>
}

export default async function PartyPlayPage({ params }: PageProps) {
  const { code } = await params
  const party = await db.party.findUnique({ where: { code } })
  if (!party) notFound()

  const me = await getPartyMembership(party.id)
  if (!me) {
    // Redirige a la sala para unirse
    return (
      <div className="empty-state">
        <span className="ico">🚫</span>
        Necesitas unirte primero. Vuelve a la sala.
      </div>
    )
  }

  return <PartyRunner code={code} />
}
