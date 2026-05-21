import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { PartyLobby } from "@/components/PartyLobby"
import { getCurrentUser } from "@/lib/auth"
import { getPartyMembership } from "@/lib/party-me"

export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ code: string }>
}

export default async function PartyPage({ params }: PageProps) {
  const { code } = await params
  const party = await db.party.findUnique({ where: { code } })
  if (!party) notFound()

  // Cualquier usuario (incluso guest) puede unirse a cualquier party.
  // No hay gating por tier al unirse: el invitado verá las preguntas
  // (FREE o PRO) que el host eligió al crear la party. El único gate
  // por tier vive en POST /api/parties (creación).
  const me   = await getCurrentUser()
  const mine = await getPartyMembership(party.id)

  return (
    <PartyLobby
      code={code}
      isAuthenticated={!!me}
      isMember={!!mine}
      myDisplayName={me?.displayName ?? me?.username ?? null}
    />
  )
}
