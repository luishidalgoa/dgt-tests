import { requireAdmin } from "@/lib/adminGuard"
import Link from "next/link"
import { ChevronLeft, Shield, Sliders, KeyRound, Pencil } from "lucide-react"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Admin · DGT Tests",
  robots: { index: false, follow: false },  // no indexar nunca
}

/**
 * Layout de TODO el área /admin. Llama a requireAdmin() para que CADA
 * page hija herede el guard sin tener que repetirlo.
 *
 * `notFound()` se dispara dentro de requireAdmin() si el user no es
 * ADMIN — la página devuelve 404 indistinguible de "ruta inventada".
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin()

  return (
    <div>
      <Link href="/settings" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Volver a ajustes
      </Link>

      <header className="page-header">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Shield className="h-7 w-7" style={{ color: "var(--orange-600)" }} />
            Panel de administración
          </h1>
          <p className="lead">
            Sesión iniciada como <b>{admin.username}</b> · acceso ADMIN
          </p>
        </div>
      </header>

      <nav style={{ display: "flex", gap: 8, marginBottom: 22, flexWrap: "wrap" }}>
        <Link href="/admin" className="btn-secondary">
          <Sliders className="h-4 w-4" />
          Configuración
        </Link>
        <Link href="/admin/secrets" className="btn-secondary">
          <KeyRound className="h-4 w-4" />
          API keys
        </Link>
        <Link href="/admin/questions" className="btn-secondary">
          <Pencil className="h-4 w-4" />
          Preguntas
        </Link>
      </nav>

      {children}
    </div>
  )
}
