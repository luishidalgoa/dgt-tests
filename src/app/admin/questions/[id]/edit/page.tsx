import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeft, Pencil, ExternalLink } from "lucide-react"
import { db } from "@/lib/db"
import { questionToSlug } from "@/lib/questionUrl"
import { EditQuestionForm } from "./EditQuestionForm"

export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ id: string }>
}

/**
 * Panel admin: editor de una pregunta concreta del banco.
 *
 * Carga la pregunta + opciones + nombre de la categoría primaria (para
 * poder ofrecer un enlace "ver en sitio público"). El formulario es
 * cliente y llama a updateQuestionAction.
 */
export default async function EditQuestionPage({ params }: PageProps) {
  const { id: idParam } = await params
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
    },
  })
  if (!question) notFound()

  const cat = question.testQuestions[0]?.test.category
  const publicSlug = questionToSlug({ id: question.id, enunciado: question.enunciado })
  const publicUrl = cat ? `/preguntas/${cat.slug}/${publicSlug}` : null

  return (
    <div>
      <Link href="/admin/questions" className="back-link" style={{ marginBottom: 14 }}>
        <ChevronLeft className="h-4 w-4" />
        Listado de preguntas
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

      <EditQuestionForm
        questionId={question.id}
        initial={{
          enunciado:   question.enunciado,
          explicacion: question.explicacion,
          codigoTema:  question.codigoTema ?? "",
          imagen:      question.imagen ?? "",
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
