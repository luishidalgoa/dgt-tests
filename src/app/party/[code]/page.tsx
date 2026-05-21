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
