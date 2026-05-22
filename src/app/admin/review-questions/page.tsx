import Link from "next/link"
import { db } from "@/lib/db"
import { QUESTION_PENDING_REVIEW_WHERE } from "@/lib/questions"
import { ChevronLeft, Sparkles } from "lucide-react"
import { QuestionCard } from "./QuestionCard"

export const dynamic = "force-dynamic"

/**
 * Panel admin para revisar preguntas IA-generadas pendientes.
 *
 * Las preguntas creadas por `npm run questions:generate` entran con
 * aiGenerated=true / aiApproved=null. Aquí salen listadas con cards
 * editables: enunciado, opciones (radio para la correcta), explicación.
 *
 * Acciones por card:
 *   - Aprobar:    aiApproved=true · ya visible a usuarios
 *   - Descartar:  aiApproved=false · no se borra de BBDD (auditoría)
 *   - Editar:     modifica enunciado/opciones/explicación SIN aprobar
 *
 * El layout padre (src/app/admin/layout.tsx) ya valida que el user
 * sea ADMIN — esta página asume que se llegó aquí porque lo es.
 */
export default async function ReviewQuestionsPage() {
  const pending = await db.question.findMany({
    where:   QUESTION_PENDING_REVIEW_WHERE,
    orderBy: { id: "asc" },
    include: { options: { orderBy: { letra: "asc" } } },
  })

  const totalApproved = await db.question.count({
    where: { aiGenerated: true, aiApproved: true },
  })
  const totalDiscarded = await db.question.count({
    where: { aiGenerated: true, aiApproved: false },
  })

  return (
    <div>
      <Link href="/admin" className="back-link" style={{ marginBottom: 14 }}>
        <ChevronLeft className="h-4 w-4" />
        Admin
      </Link>

      <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
        <Sparkles className="h-5 w-5" style={{ color: "rgb(168, 85, 247)" }} />
        Preguntas IA pendientes de revisión
      </h2>
      <p style={{ color: "var(--slate-500)", fontSize: 13.5, marginBottom: 18, marginTop: 0 }}>
        Las generó `npm run questions:generate`. Aprueba las correctas para que aparezcan a usuarios,
        descarta las malas, edita las medio buenas. Nada se borra: las descartadas quedan en BBDD por auditoría.
      </p>

      {/* Métricas globales */}
      <div style={{ display: "flex", gap: 12, marginBottom: 22, flexWrap: "wrap" }}>
        <Metric label="Pendientes"  value={pending.length} accent="amber" />
        <Metric label="Aprobadas"   value={totalApproved}  accent="green" />
        <Metric label="Descartadas" value={totalDiscarded} accent="red"   />
      </div>

      {pending.length === 0 ? (
        <div
          className="card-soft"
          style={{
            padding: 28,
            textAlign: "center",
            color: "var(--slate-500)",
            border: "1px dashed var(--slate-200)",
          }}
        >
          <p style={{ margin: 0, fontSize: 14 }}>
            🎉 No hay preguntas pendientes. Para generar más:
          </p>
          <pre style={{
            marginTop: 12,
            display: "inline-block",
            padding: "8px 14px",
            borderRadius: 8,
            background: "var(--slate-100)",
            fontSize: 12,
          }}>
            npm run questions:generate -- --count 60
          </pre>
        </div>
      ) : (
        <div>
          {pending.map((q) => (
            <QuestionCard
              key={q.id}
              questionId={q.id}
              codigoTema={q.codigoTema}
              enunciado={q.enunciado}
              explicacion={q.explicacion}
              options={q.options.map((o) => ({
                id:        o.id,
                letra:     o.letra,
                texto:     o.texto,
                isCorrect: o.isCorrect,
              }))}
              aiModel={q.aiModel}
              createdLabel={"recientemente"}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, accent }: { label: string; value: number; accent: "amber" | "green" | "red" }) {
  const color =
    accent === "amber" ? "var(--amber)"   :
    accent === "green" ? "var(--green-d)" :
                          "var(--red-600)"
  const bg =
    accent === "amber" ? "rgba(245, 158, 11, 0.10)" :
    accent === "green" ? "rgba(34, 197, 94, 0.10)"  :
                          "rgba(239, 68, 68, 0.10)"
  return (
    <div
      className="card-soft"
      style={{
        padding: "14px 18px",
        minWidth: 130,
        background: bg,
        border: `1px solid ${color}33`,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 800, color: "var(--slate-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div className="font-mono-tabular" style={{ fontSize: 28, fontWeight: 900, color, marginTop: 4 }}>
        {value}
      </div>
    </div>
  )
}
