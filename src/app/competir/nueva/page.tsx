import Link from "next/link"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { ChevronLeft, Swords } from "lucide-react"
import { NewPartyForm } from "@/components/NewPartyForm"

export const dynamic = "force-dynamic"

export default async function NuevaPartyPage() {
  await requireUser()
  const categories = await db.category.findMany({ orderBy: { id: "asc" } })

  return (
    <div>
      <Link href="/competir" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Modo competición
      </Link>

      <header className="page-header">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Swords className="h-7 w-7" style={{ color: "var(--red-600)" }} />
            Crear party
          </h1>
          <p className="lead">
            Elige categoría y número de preguntas. Recibirás un código para invitar
            hasta 3 amigos (4 jugadores en total).
          </p>
        </div>
      </header>

      <NewPartyForm categories={categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug }))} />
    </div>
  )
}
