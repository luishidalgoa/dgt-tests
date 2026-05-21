import Link from "next/link"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { hasFullAccess } from "@/lib/permissions"
import { ChevronLeft, BookOpen } from "lucide-react"
import { ManualSectionLauncher } from "@/components/ManualSectionLauncher"
import type { ManualSectionData, ManualPage } from "@/lib/manual"

export const dynamic = "force-dynamic"

export default async function LibroPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/")
  if (!hasFullAccess(user)) redirect("/upgrade")

  const rows = await db.manualSection.findMany({
    orderBy: [{ temaCode: "asc" }, { subtemaCode: "asc" }],
  })

  // Agrupar por tema
  type Group = {
    temaCode: string
    temaName: string
    sections: ManualSectionData[]
  }
  const groups = new Map<string, Group>()
  for (const s of rows) {
    if (!groups.has(s.temaCode)) {
      groups.set(s.temaCode, { temaCode: s.temaCode, temaName: s.temaName, sections: [] })
    }
    groups.get(s.temaCode)!.sections.push({
      id:          s.id,
      temaCode:    s.temaCode,
      temaName:    s.temaName,
      subtemaCode: s.subtemaCode,
      subtemaName: s.subtemaName,
      folder:      s.folder,
      totalPages:  s.totalPages,
      pages:       JSON.parse(s.pages) as ManualPage[],
      pdfFilename: s.pdfFilename,
    })
  }
  const groupArr = Array.from(groups.values()).sort((a, b) => {
    const na = parseInt(a.temaCode, 10) || 0
    const nb = parseInt(b.temaCode, 10) || 0
    return na - nb
  })

  return (
    <div>
      <Link href="/temas" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Volver a temas
      </Link>

      <header className="page-header">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <BookOpen className="h-7 w-7" />
            Libro completo
          </h1>
          <p className="lead">
            Todas las secciones del temario, ordenadas. Pulsa cualquier sección para abrirla.
          </p>
        </div>
        <span className="badge">{rows.length} secciones</span>
      </header>

      <div className="space-y-6">
        {groupArr.map((g) => (
          <section key={g.temaCode}>
            <h2
              style={{
                margin: "0 4px 10px",
                fontSize: 14,
                fontWeight: 800,
                color: "var(--slate-500)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span
                className="font-mono-tabular"
                style={{
                  padding: "3px 9px",
                  borderRadius: 6,
                  background: "rgba(249, 115, 22, 0.12)",
                  color: "var(--orange-600)",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                Tema {g.temaCode}
              </span>
              <span style={{ color: "var(--ink)", textTransform: "none", letterSpacing: 0, fontSize: 15 }}>
                {g.temaName}
              </span>
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.sections.map((s) => (
                <ManualSectionLauncher key={s.id} section={s} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
