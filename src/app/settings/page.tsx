import Link from "next/link"
import { requireUser } from "@/lib/auth"
import { ChevronLeft, Settings } from "lucide-react"
import { SettingsForm } from "@/components/SettingsForm"

export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  const user = await requireUser()

  return (
    <div>
      <Link href="/" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Inicio
      </Link>

      <header className="page-header">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Settings className="h-7 w-7" />
            Configuración
          </h1>
          <p className="lead">Edita tu nombre de usuario y cómo apareces en la app.</p>
        </div>
      </header>

      <SettingsForm
        initialUsername={user.username}
        initialDisplayName={user.displayName ?? user.username}
      />
    </div>
  )
}
