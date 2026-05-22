"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { CheckCircle2, XCircle, Pencil, Save, X, Loader2 } from "lucide-react"
import { approveQuestionAction, discardQuestionAction, editQuestionAction } from "./actions"

interface OptionData {
  id:        number
  letra:     string
  texto:     string
  isCorrect: boolean
}

interface Props {
  questionId:  number
  codigoTema:  string | null
  enunciado:   string
  explicacion: string
  options:     OptionData[]
  aiModel:     string | null
  createdLabel: string
}

/**
 * Card editable de una pregunta IA-generada pendiente de review.
 * Botones: Aprobar / Descartar / Editar (toggle modo edición).
 * En modo edición se pueden cambiar enunciado, explicación, textos
 * de opciones y cuál es la correcta.
 */
export function QuestionCard(props: Props) {
  const [isPending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)

  // Estado local para el modo edición
  const [enunciado, setEnunciado] = useState(props.enunciado)
  const [explicacion, setExplicacion] = useState(props.explicacion)
  const [options, setOptions] = useState<OptionData[]>(props.options)

  function reset() {
    setEnunciado(props.enunciado)
    setExplicacion(props.explicacion)
    setOptions(props.options)
    setEditing(false)
  }

  function handleApprove() {
    startTransition(async () => {
      const f = new FormData()
      f.set("id", String(props.questionId))
      const res = await approveQuestionAction(f)
      if (res.ok) toast.success("Aprobada · ya visible a usuarios")
      else        toast.error(res.error)
    })
  }

  function handleDiscard() {
    if (!confirm("¿Descartar esta pregunta? No se borra de BBDD pero deja de aparecer.")) return
    startTransition(async () => {
      const f = new FormData()
      f.set("id", String(props.questionId))
      const res = await discardQuestionAction(f)
      if (res.ok) toast.success("Descartada")
      else        toast.error(res.error)
    })
  }

  function handleSaveEdit() {
    if (options.filter((o) => o.isCorrect).length !== 1) {
      toast.error("Debe haber exactamente 1 opción correcta")
      return
    }
    startTransition(async () => {
      const f = new FormData()
      f.set("id", String(props.questionId))
      f.set("enunciado", enunciado)
      f.set("explicacion", explicacion)
      f.set("optionsJson", JSON.stringify(
        options.map((o) => ({ id: o.id, texto: o.texto, isCorrect: o.isCorrect }))
      ))
      const res = await editQuestionAction(f)
      if (res.ok) {
        toast.success("Cambios guardados (sigue pendiente de aprobar)")
        setEditing(false)
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <article
      style={{
        border:       "1px solid var(--slate-200)",
        borderRadius: 12,
        padding:      18,
        marginBottom: 14,
        background:   "#fff",
      }}
    >
      {/* Metadata */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span
            className="font-mono-tabular"
            style={{
              padding: "3px 9px",
              borderRadius: 6,
              background: "rgba(168, 85, 247, 0.10)",
              color: "rgb(126, 34, 206)",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {props.codigoTema ?? "(sin codigoTema)"}
          </span>
          <span style={{ fontSize: 11, color: "var(--slate-400)" }}>
            modelo: {props.aiModel ?? "(desconocido)"} · creada {props.createdLabel}
          </span>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--amber-d)" }}>
          PENDIENTE
        </span>
      </div>

      {/* Enunciado */}
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: "var(--slate-500)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Enunciado
        </label>
        {editing ? (
          <textarea
            value={enunciado}
            onChange={(e) => setEnunciado(e.target.value)}
            rows={2}
            disabled={isPending}
            style={textareaStyle}
          />
        ) : (
          <p style={{ margin: "4px 0 0", fontSize: 14, lineHeight: 1.5 }}>{enunciado}</p>
        )}
      </div>

      {/* Opciones */}
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: "var(--slate-500)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Opciones (radio = correcta)
        </label>
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
          {options.map((o, idx) => (
            <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="radio"
                name={`correct-${props.questionId}`}
                checked={o.isCorrect}
                onChange={() => {
                  setOptions(options.map((opt, i) => ({ ...opt, isCorrect: i === idx })))
                }}
                disabled={!editing || isPending}
                style={{ cursor: editing ? "pointer" : "not-allowed" }}
              />
              <span className="font-mono-tabular" style={{
                width: 22, textAlign: "center", fontSize: 12, fontWeight: 800,
                color: o.isCorrect ? "var(--green-d)" : "var(--slate-500)",
              }}>
                {o.letra}
              </span>
              {editing ? (
                <input
                  type="text"
                  value={o.texto}
                  onChange={(e) => {
                    const next = [...options]
                    next[idx] = { ...next[idx], texto: e.target.value }
                    setOptions(next)
                  }}
                  disabled={isPending}
                  style={{ ...inputStyle, flex: 1 }}
                />
              ) : (
                <span style={{
                  flex: 1, fontSize: 13.5,
                  color: o.isCorrect ? "var(--green-d)" : "var(--slate-700)",
                  fontWeight: o.isCorrect ? 600 : 400,
                }}>
                  {o.texto}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Explicación */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: "var(--slate-500)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Explicación
        </label>
        {editing ? (
          <textarea
            value={explicacion}
            onChange={(e) => setExplicacion(e.target.value)}
            rows={3}
            disabled={isPending}
            style={textareaStyle}
          />
        ) : (
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--slate-600)", lineHeight: 1.5, fontStyle: "italic" }}>
            {explicacion}
          </p>
        )}
      </div>

      {/* Acciones */}
      <div style={{ display: "flex", gap: 8 }}>
        {editing ? (
          <>
            <button onClick={handleSaveEdit} disabled={isPending} style={btnPrimary}>
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Guardar cambios
            </button>
            <button onClick={reset} disabled={isPending} style={btnSecondary}>
              <X className="h-3.5 w-3.5" />
              Cancelar
            </button>
          </>
        ) : (
          <>
            <button onClick={handleApprove} disabled={isPending} style={{ ...btnPrimary, background: "var(--green)" }}>
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Aprobar
            </button>
            <button onClick={handleDiscard} disabled={isPending} style={{ ...btnSecondary, background: "rgba(239,68,68,0.10)", color: "var(--red-600)" }}>
              <XCircle className="h-3.5 w-3.5" />
              Descartar
            </button>
            <button onClick={() => setEditing(true)} disabled={isPending} style={btnSecondary}>
              <Pencil className="h-3.5 w-3.5" />
              Editar
            </button>
          </>
        )}
      </div>
    </article>
  )
}

const textareaStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 4,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1.5px solid var(--slate-200)",
  fontSize: 13.5,
  fontFamily: "inherit",
  resize: "vertical",
}

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,
  border: "1.5px solid var(--slate-200)",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
}

const btnPrimary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: 0,
  background: "var(--orange-600)",
  color: "white",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
}

const btnSecondary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1.5px solid var(--slate-200)",
  background: "#fff",
  color: "var(--slate-700)",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
}
