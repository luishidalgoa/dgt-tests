import Link from "next/link"
import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { PartyLobby } from "@/components/PartyLobby"
import { getCurrentUser } from "@/lib/auth"
import { getPartyMembership } from "@/lib/party-me"
import { canJoinPartyWithCategory } from "@/lib/permissions"
import { Lock, Crown } from "lucide-react"

export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ code: string }>
}

export default async function PartyPage({ params }: PageProps) {
  const { code } = await params
  const party = await db.party.findUnique({
    where: { code },
    include: { category: { select: { slug: true, name: true } } },
  })
  if (!party) notFound()

  const me   = await getCurrentUser()
  const mine = await getPartyMembership(party.id)

  // ── Gating por plan: si la party usa contenido PRO y el usuario no es
  //    PRO/admin (y NO es ya miembro), mostramos un upsell. Los miembros
  //    existentes siguen viendo la lobby normal. ──
  const isAlreadyMember = !!mine
  const canJoin = canJoinPartyWithCategory(me, party.category?.slug ?? null)
  if (!isAlreadyMember && !canJoin) {
    return (
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <div
          className="card-soft warm"
          style={{
            padding: 28,
            textAlign: "center",
            background:
              "linear-gradient(135deg, rgba(168, 85, 247, 0.06), rgba(236, 72, 153, 0.04))",
            borderColor: "rgba(168, 85, 247, 0.35)",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              margin: "0 auto 14px",
              background: "linear-gradient(135deg, rgb(168, 85, 247), rgb(236, 72, 153))",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Lock className="h-6 w-6" />
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>
            Party PRO
          </h1>
          <p
            style={{
              margin: "8px 0 18px",
              fontSize: 14,
              color: "var(--slate-600)",
              lineHeight: 1.55,
            }}
          >
            Esta party usa contenido de la categoría{" "}
            <b>{party.category?.name ?? "PRO"}</b>, disponible solo en el plan
            PRO. Suscríbete por 5€/mes para unirte.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <Link
              href={me ? "/upgrade" : "/register?redirect=/party/" + code}
              className="btn-primary"
              style={{
                background: "linear-gradient(135deg, rgb(168, 85, 247), rgb(236, 72, 153))",
                boxShadow: "0 10px 22px -10px rgba(168, 85, 247, 0.55)",
              }}
            >
              <Crown className="h-4 w-4" />
              {me ? "Suscribirme · 5€/mes" : "Crear cuenta gratis"}
            </Link>
            <Link href="/" className="btn-secondary">
              Volver al inicio
            </Link>
          </div>
          <p
            style={{
              marginTop: 14,
              fontSize: 11.5,
              color: "var(--slate-500)",
            }}
          >
            Código de party: <code>{code}</code>
          </p>
        </div>
      </div>
    )
  }

  return (
    <PartyLobby
      code={code}
      isAuthenticated={!!me}
      isMember={!!mine}
      myDisplayName={me?.displayName ?? me?.username ?? null}
    />
  )
}
