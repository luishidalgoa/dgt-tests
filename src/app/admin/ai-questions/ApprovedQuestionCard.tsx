"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { XCircle, Loader2, Sparkles, ChevronDown, ChevronRight, Pencil } from "lucide-react"
import { discardApprovedQuestionAction } from "./actions"

interface OptionData {
  letra:     string
  texto:     string
  isCorrect: boolean
}

interface Props {
  questionId:   number
  codigoTema:   string | null
  enunciado:    string
  explicacion:  string
  options:      OptionData[]
  aiModel:      string | null
  reviewedAt:   Date | null
}

/**
 * Card para preguntas IA ya aprobadas. Acciones:
 *   - Editar:    navega a /admin/questions/[id]/edit?from=ai-questions,
 *                que reutiliza el mismo formulario que usa el editor
 *                normal del banco (incluye enunciado, codigoTema, tier
 *                FREE/PRO, imagen + picker del banco, opciones,
 *                explicación, sugerencia IA). Al guardar vuelve aquí.
 *   - Descartar: revierte la aprobación (la pregunta deja de aparecer
 *                a usuarios). No se borra de BBDD — el admin puede
 *                re-aprobarla a mano si fue un error.
 */
export function ApprovedQuestionCard(props: Props) {
  const [isPending, startTransition] = useTransition()
  const [showExplicacion, setShowExplicacion] = useState(false)

  function handleDiscard() {
    if (!confirm("¿Descartar esta pregunta? Dejará de aparecer a los usuarios. (No se borra de BBDD.)")) return
    startTransition(async () => {
      const f = new FormData()
      f.set("id", String(props.questionId))
      const res = await discardApprovedQuestionAction(f)
      if (res.ok) toast.success("Descartada · ya no visible a usuarios")
      else        toast.error(res.error)
    })
  }

  return (
    <article
      style={{
        border:       "1px solid rgba(34, 197, 94, 0.30)",
        borderRadius: 12,
        padding:      16,
        marginBottom: 10,
        background:   "rgba(34, 197, 94, 0.04)",
      }}
    >
      {/* Header con código y modelo */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span
            style={{
              display:      "inline-flex",
              alignItems:   "center",
              gap:          4,
              padding:      "2px 8px",
              borderRadius: 999,
              background:   "rgba(168, 85, 247, 0.10)",
              color:        "rgb(126, 34, 206)",
              fontSize:     10.5,
              fontWeight:   800,
            }}
          >
            <Sparkles className="h-3 w-3" />
            IA
          </span>
          <span
            className="font-mono-tabular"
            style={{
              padding:      "2px 8px",
              borderRadius: 6,
              background:   "#fff",
              border:       "1px solid var(--slate-200)",
              fontSize:     11,
              fontWeight:   700,
              color:        "var(--slate-700)",
            }}
          >
            {props.codigoTema ?? "(sin codigoTema)"}
          </span>
          {props.aiModel && (
            <span style={{ fontSize: 11, color: "var(--slate-500)" }}>
              {props.aiModel}
            </span>
          )}
          {props.reviewedAt && (
            <span style={{ fontSize: 11, color: "var(--slate-400)" }}>
              · aprobada {props.reviewedAt.toLocaleDateString("es-ES")}
            </span>
          )}
        </div>
      </div>

      {/* Enunciado */}
      <p style={{ margin: "0 0 8px", fontSize: 14, lineHeight: 1.5, fontWeight: 500 }}>
        {props.enunciado}
      </p>

      {/* Opciones */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
        {props.options.map((o) => (
          <div
            key={o.letra}
            style={{
              display:      "flex",
              alignItems:   "flex-start",
              gap:          8,
              padding:      "5px 8px",
              borderRadius: 6,
              background:   o.isCorrect ? "rgba(34, 197, 94, 0.12)" : "transparent",
              fontSize:     13,
            }}
          >
            <span
              className="font-mono-tabular"
              style={{
                width:      18,
                textAlign:  "center",
                fontWeight: 800,
                color:      o.isCorrect ? "var(--green-d)" : "var(--slate-500)",
              }}
            >
              {o.letra.toUpperCase()}
            </span>
            <span
              style={{
                flex:       1,
                color:      o.isCorrect ? "var(--green-d)" : "var(--slate-700)",
                fontWeight: o.isCorrect ? 600 : 400,
              }}
            >
              {o.texto}
              {o.isCorrect && <span style={{ marginLeft: 6, fontSize: 11 }}>✓</span>}
            </span>
          </div>
        ))}
      </div>

      {/* Explicación colapsable */}
      {props.explicacion && (
        <div style={{ marginBottom: 10 }}>
          <button
            type="button"
            onClick={() => setShowExplicacion((v) => !v)}
            style={{
              display:      "inline-flex",
              alignItems:   "center",
              gap:          4,
              padding:      "4px 8px",
              borderRadius: 6,
              border:       "1px dashed var(--slate-300)",
              background:   "#fff",
              fontSize:     11.5,
              fontWeight:   600,
              color:        "var(--slate-600)",
              cursor:       "pointer",
            }}
          >
            {showExplicacion ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {showExplicacion ? "Ocultar" : "Ver"} explicación
          </button>
          {showExplicacion && (
            <p style={{
              margin:       "6px 0 0",
              padding:      "8px 10px",
              borderRadius: 8,
              background:   "rgba(255,255,255,0.7)",
              border:       "1px solid var(--slate-200)",
              fontSize:     12.5,
              color:        "var(--slate-600)",
              lineHeight:   1.5,
              fontStyle:    "italic",
            }}>
              {props.explicacion}
            </p>
          )}
        </div>
      )}

      {/* Acciones: editar (reusa el editor del banco) + descartar */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Link
          href={`/admin/questions/${props.questionId}/edit?from=ai-questions`}
          aria-disabled={isPending}
          style={{
            padding:        "6px 11px",
            borderRadius:   8,
            border:         "1.5px solid var(--slate-200)",
            background:     "#fff",
            color:          "var(--slate-700)",
            fontWeight:     600,
            fontSize:       12,
            textDecoration: "none",
            cursor:         isPending ? "wait" : "pointer",
            display:        "inline-flex",
            alignItems:     "center",
            gap:            5,
            pointerEvents:  isPending ? "none" : "auto",
            opacity:        isPending ? 0.5 : 1,
          }}
        >
          <Pencil className="h-3.5 w-3.5" />
          Editar
        </Link>
        <button
          onClick={handleDiscard}
          disabled={isPending}
          style={{
            padding:        "6px 11px",
            borderRadius:   8,
            border:         "1.5px solid rgba(239, 68, 68, 0.25)",
            background:     "rgba(239, 68, 68, 0.06)",
            color:          "var(--red-600)",
            fontWeight:     600,
            fontSize:       12,
            cursor:         isPending ? "wait" : "pointer",
            display:        "inline-flex",
            alignItems:     "center",
            gap:            5,
          }}
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
          Descartar
        </button>
      </div>
    </article>
  )
}
