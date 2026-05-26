import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeft, Pencil, ExternalLink, AlertTriangle, MessageSquareWarning } from "lucide-react"
import { db } from "@/lib/db"
import { questionToSlug } from "@/lib/questionUrl"
import { reportTypeLabel } from "@/lib/questionReports"
import { EditQuestionForm } from "./EditQuestionForm"

export const dynamic = "force-dynamic"

interface PageProps {
  params:       Promise<{ id: string }>
  searchParams: Promise<{ from?: string }>
}

/**
 * Panel admin: editor de una pregunta concreta del banco.
 *
 * Carga la pregunta + opciones + nombre de la categoría primaria (para
 * poder ofrecer un enlace "ver en sitio público"). El formulario es
 * cliente y llama a updateQuestionAction.
 *
 * Param `from`: el editor reconoce varios orígenes para ajustar el
 * breadcrumb y el redirect post-guardado:
 *   - `?from=reports`      → vuelve a /admin/reports
 *   - `?from=ai-questions` → vuelve a /admin/ai-questions
 *   - (ausente)            → se queda en la misma página tras guardar
 */
function resolveOrigin(from: string | undefined): {
  href:   string
  label:  string
  redirectAfterSave: string | null
} | null {
  if (from === "reports") {
    return {
      href:              "/admin/reports",
      label:             "Incidencias reportadas",
      redirectAfterSave: "/admin/reports",
    }
  }
  if (from === "ai-questions") {
    return {
      href:              "/admin/ai-questions",
      label:             "Preguntas IA aprobadas",
      redirectAfterSave: "/admin/ai-questions",
    }
  }
  return null
}

export default async function EditQuestionPage({ params, searchParams }: PageProps) {
  const { id: idParam } = await params
  const { from }        = await searchParams
  const origin          = resolveOrigin(from)
  const backHref        = origin?.href              ?? "/admin/questions"
  const backLabel       = origin?.label             ?? "Listado de preguntas"
  const redirectAfterSave = origin?.redirectAfterSave ?? null
  const id = parseInt(idParam, 10)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const question = await db.question.findUnique({
    where:   { id },
    include: {
      options: { orderBy: { letra: "asc" } },
      testQuestions: {
        take:    1,
        orderBy: { test: { testNumber: "asc" } },
        select:  { test: { select: { category: { select: { slug: true, name: true } } } } },
      },
      lastEditedByUser: {
        select: { id: true, username: true, displayName: true },
      },
      // Reports abiertos sobre esta pregunta — los listamos arriba del
      // editor para que el admin tenga contexto antes de tocar nada.
      // Al guardar la edición se marcan como `fixed` automáticamente.
      reports: {
        where:   { status: "pending" },
        orderBy: { createdAt: "desc" },
      },
    },
  })
  if (!question) notFound()

  const cat = question.testQuestions[0]?.test.category
  const publicSlug = questionToSlug({ id: question.id, enunciado: question.enunciado })
  const publicUrl = cat ? `/preguntas/${cat.slug}/${publicSlug}` : null

  return (
    <div>
      <Link
        href={backHref}
        className="back-link"
        style={{ marginBottom: 14 }}
      >
        <ChevronLeft className="h-4 w-4" />
        {backLabel}
      </Link>

      <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
        <Pencil className="h-5 w-5" />
        Editar pregunta <span className="font-mono-tabular" style={{ color: "var(--orange-600)" }}>#{question.id}</span>
      </h2>
      <p style={{ color: "var(--slate-500)", fontSize: 13.5, marginBottom: 16, marginTop: 0 }}>
        Los cambios revalidan las páginas SEO al instante y borran el cache
        IA de esta pregunta si modificas opciones o enunciado. Para que
        suban a Turso desde dev, ejecuta{" "}
        <code style={{ background: "var(--slate-100)", padding: "1px 6px", borderRadius: 4 }}>
          npm run turso:sync-question -- --id {question.id}
        </code>
        .
      </p>

      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap", alignItems: "center", fontSize: 12, color: "var(--slate-600)" }}>
        <span>
          externalId:{" "}
          <code className="font-mono-tabular" style={{ background: "var(--slate-100)", padding: "1px 6px", borderRadius: 4 }}>
            {question.externalId}
          </code>
        </span>
        <span>
          tier:{" "}
          <b style={{ color: question.tier === "PRO" ? "var(--orange-600)" : "var(--green-d)" }}>
            {question.tier}
          </b>
        </span>
        {question.aiGenerated && (
          <span style={{ padding: "2px 8px", borderRadius: 999, background: "rgba(168, 85, 247, 0.10)", color: "rgb(126, 34, 206)", fontSize: 11, fontWeight: 700 }}>
            IA · {question.aiApproved === true ? "aprobada" : question.aiApproved === false ? "descartada" : "pendiente"}
          </span>
        )}
        {question.lastEditedAt && (
          <span>
            última edición:{" "}
            <b>{question.lastEditedAt.toLocaleString("es-ES")}</b>
            {question.lastEditedByUser && (
              <> por <b>{question.lastEditedByUser.displayName || question.lastEditedByUser.username}</b></>
            )}
          </span>
        )}
        {publicUrl && (
          <a href={publicUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--orange-600)", textDecoration: "none" }}>
            Ver en sitio público <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {/* Reports pendientes asociados a esta pregunta */}
      {question.reports.length > 0 && (
        <div
          className="card-soft"
          style={{
            padding:      16,
            marginBottom: 16,
            background:   "rgba(245, 158, 11, 0.06)",
            border:       "1px solid rgba(245, 158, 11, 0.30)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <MessageSquareWarning className="h-4 w-4" style={{ color: "var(--amber-d, #92400e)" }} />
            <span style={{ fontSize: 13, fontWeight: 800, color: "var(--amber-d, #92400e)" }}>
              {question.reports.length === 1
                ? "1 incidencia pendiente reportada por un usuario"
                : `${question.reports.length} incidencias pendientes reportadas por usuarios`}
            </span>
            <Link
              href="/admin/reports"
              style={{
                marginLeft:     "auto",
                fontSize:       11.5,
                color:          "var(--orange-600)",
                textDecoration: "none",
              }}
            >
              Ver panel completo →
            </Link>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--slate-700)" }}>
            {question.reports.map((r) => (
              <li key={r.id} style={{ marginBottom: 6 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <AlertTriangle className="h-3 w-3" style={{ color: "var(--amber-d, #92400e)" }} />
                  <b>{reportTypeLabel(r.type)}</b>
                </span>
                {r.comment && (
                  <span style={{ color: "var(--slate-600)" }}> — “{r.comment}”</span>
                )}
                <span style={{ color: "var(--slate-400)", fontSize: 11, marginLeft: 6 }}>
                  ({r.createdAt.toLocaleDateString("es-ES")})
                </span>
              </li>
            ))}
          </ul>
          <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--slate-500)", fontStyle: "italic" }}>
            Al guardar cambios, estas incidencias se marcan como <b>fixed</b> automáticamente.
            Puedes reabrirlas desde el panel de reports si no atendían a estos cambios.
          </p>
        </div>
      )}

      <EditQuestionForm
        questionId={question.id}
        redirectAfterSave={redirectAfterSave}
        initial={{
          enunciado:   question.enunciado,
          explicacion: question.explicacion,
          codigoTema:  question.codigoTema ?? "",
          imagen:      question.imagen ?? "",
          tier:        question.tier,
          options:     question.options.map((o) => ({
            id:        o.id,
            letra:     o.letra,
            texto:     o.texto,
            isCorrect: o.isCorrect,
          })),
        }}
      />
    </div>
  )
}
