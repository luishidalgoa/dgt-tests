"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { toast } from "sonner"
import { Save, Loader2, ImageIcon, Lock, Unlock } from "lucide-react"
import { imageUrl } from "@/lib/imageUrl"
import { updateQuestionAction } from "../../actions"
import { AISuggestPanel } from "./AISuggestPanel"
import { ImageBankPickerButton } from "@/app/admin/images-bank/ImageBankPicker"

interface OptionData {
  id:        number
  letra:     string
  texto:     string
  isCorrect: boolean
}

/** Mismo enum que `ContentTier` en Prisma. Mantenido aquí como union
 *  literal en vez de import porque el cliente no debe arrastrar el
 *  bundle de Prisma. */
type Tier = "FREE" | "PRO"

interface Props {
  questionId: number
  /** Si está, tras guardar con éxito hacemos router.push() a esa ruta.
   *  Sirve para volver a /admin/reports cuando el admin llegó al
   *  editor desde una incidencia reportada (?from=reports). Si es null,
   *  el form se queda en la misma página tras guardar. */
  redirectAfterSave?: string | null
  initial: {
    enunciado:   string
    explicacion: string
    codigoTema:  string
    imagen:      string
    tier:        Tier
    options:     OptionData[]
  }
}

/**
 * Form de edición de pregunta. Estado local controlado; al submit
 * serializa las opciones a JSON (el form HTML no maneja bien arrays
 * anidados) y llama a updateQuestionAction.
 */
export function EditQuestionForm({ questionId, redirectAfterSave, initial }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [enunciado, setEnunciado]    = useState(initial.enunciado)
  const [explicacion, setExplicacion] = useState(initial.explicacion)
  const [codigoTema, setCodigoTema]  = useState(initial.codigoTema)
  const [imagen, setImagen]          = useState(initial.imagen)
  const [tier, setTier]              = useState<Tier>(initial.tier)
  const [options, setOptions]        = useState<OptionData[]>(initial.options)

  function setCorrect(idx: number) {
    setOptions(options.map((o, i) => ({ ...o, isCorrect: i === idx })))
  }

  function setText(idx: number, texto: string) {
    const next = [...options]
    next[idx] = { ...next[idx], texto }
    setOptions(next)
  }

  function handleSubmit() {
    if (options.filter((o) => o.isCorrect).length !== 1) {
      toast.error("Debe haber exactamente 1 opción correcta")
      return
    }
    if (enunciado.trim().length < 10) {
      toast.error("El enunciado debe tener al menos 10 caracteres")
      return
    }
    startTransition(async () => {
      const f = new FormData()
      f.set("id", String(questionId))
      f.set("enunciado", enunciado)
      f.set("explicacion", explicacion)
      f.set("codigoTema", codigoTema)
      f.set("imagen", imagen)
      f.set("tier", tier)
      f.set("optionsJson", JSON.stringify(
        options.map((o) => ({ id: o.id, texto: o.texto, isCorrect: o.isCorrect }))
      ))
      try {
        const res = await updateQuestionAction(f)
        if (res.ok) {
          toast.success(
            redirectAfterSave === "/admin/reports"      ? "Cambios guardados — volviendo a incidencias" :
            redirectAfterSave === "/admin/ai-questions" ? "Cambios guardados — volviendo a IA aprobadas" :
                                                          "Cambios guardados — caché invalidada"
          )
          if (redirectAfterSave) {
            router.push(redirectAfterSave)
          }
        } else {
          toast.error(res.error)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error inesperado")
      }
    })
  }

  return (
    <div className="card-soft" style={{ padding: 22 }}>
      {/* Enunciado */}
      <Field label="Enunciado">
        <textarea
          value={enunciado}
          onChange={(e) => setEnunciado(e.target.value)}
          rows={3}
          disabled={isPending}
          style={textareaStyle}
        />
      </Field>

      {/* codigoTema */}
      <Field label="codigoTema" hint='Formato esperado: "TC X.Y-Z.W (X-Y.Z)"'>
        <input
          type="text"
          value={codigoTema}
          onChange={(e) => setCodigoTema(e.target.value)}
          disabled={isPending}
          placeholder="TC 7.3-3.1.3 (7-3.3.1)"
          style={inputStyle}
        />
      </Field>

      {/* Tier (FREE / PRO) */}
      <Field
        label="Acceso (tier)"
        hint="FREE: visible a usuarios sin suscripción. PRO: requiere suscripción activa (o ser ADMIN). Por defecto las preguntas son PRO; marcar FREE solo las que pertenezcan a los tests gratuitos."
      >
        <div style={{ display: "flex", gap: 8 }}>
          <TierToggle
            value="FREE"
            current={tier}
            onChange={setTier}
            disabled={isPending}
            label="Gratuita"
            description="Visible sin suscripción"
            icon={<Unlock className="h-3.5 w-3.5" />}
            color="green"
          />
          <TierToggle
            value="PRO"
            current={tier}
            onChange={setTier}
            disabled={isPending}
            label="Pro"
            description="Requiere suscripción"
            icon={<Lock className="h-3.5 w-3.5" />}
            color="orange"
          />
        </div>
      </Field>

      {/* Imagen */}
      <Field label="Imagen (filename)" hint="Solo el nombre del archivo (p.ej. 320671.png). Se resuelve vía imageUrl() según CDN o /public/images.">
        <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
          <input
            type="text"
            value={imagen}
            onChange={(e) => setImagen(e.target.value)}
            disabled={isPending}
            placeholder="320671.png"
            style={{ ...inputStyle, flex: 1 }}
          />
          <ImageBankPickerButton
            onSelect={(filename) => setImagen(filename)}
            disabled={isPending}
            canWriteTagFeedback
          />
          {imagen.trim().length > 0 && (
            <button
              type="button"
              onClick={() => setImagen("")}
              disabled={isPending}
              title="Quitar imagen"
              style={{
                padding:      "8px 12px",
                borderRadius: 8,
                border:       "1.5px solid var(--slate-200)",
                background:   "#fff",
                color:        "var(--red-600)",
                fontWeight:   600,
                fontSize:     12.5,
                cursor:       isPending ? "not-allowed" : "pointer",
                opacity:      isPending ? 0.5 : 1,
              }}
            >
              Quitar
            </button>
          )}
        </div>
        {imagen.trim().length > 0 && (
          <div style={{
            marginTop:    10,
            padding:      12,
            borderRadius: 10,
            background:   "var(--slate-50, #f8fafc)",
            border:       "1px dashed var(--slate-200)",
            display:      "flex",
            alignItems:   "center",
            justifyContent: "center",
          }}>
            <div style={{ position: "relative", width: 240, aspectRatio: "4 / 3" }}>
              <Image
                src={imageUrl(imagen.trim())}
                alt="preview"
                fill
                sizes="240px"
                style={{ objectFit: "contain" }}
                unoptimized
              />
            </div>
          </div>
        )}
        {imagen.trim().length === 0 && (
          <div style={{
            marginTop: 8, padding: "8px 12px",
            fontSize: 12, color: "var(--slate-400)",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            <ImageIcon className="h-3.5 w-3.5" />
            Sin imagen — la pregunta se renderiza solo con texto.
          </div>
        )}
      </Field>

      {/* Segunda opinión IA — el panel sabe qué letra hay marcada ahora
          para resaltar si la sugerencia coincide o no. */}
      <AISuggestPanel
        questionId={questionId}
        currentCorrectLetra={options.find((o) => o.isCorrect)?.letra ?? null}
      />

      {/* Opciones */}
      <Field label="Opciones (radio = correcta)">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {options.map((o, idx) => (
            <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="radio"
                name={`correct-${questionId}`}
                checked={o.isCorrect}
                onChange={() => setCorrect(idx)}
                disabled={isPending}
                style={{ cursor: "pointer", flexShrink: 0 }}
              />
              <span className="font-mono-tabular" style={{
                width:     24,
                textAlign: "center",
                fontWeight: 800,
                fontSize:  13,
                color:     o.isCorrect ? "var(--green-d)" : "var(--slate-500)",
                flexShrink: 0,
              }}>
                {o.letra}
              </span>
              <input
                type="text"
                value={o.texto}
                onChange={(e) => setText(idx, e.target.value)}
                disabled={isPending}
                style={{ ...inputStyle, flex: 1, marginTop: 0 }}
              />
            </div>
          ))}
        </div>
      </Field>

      {/* Explicación */}
      <Field label="Explicación">
        <textarea
          value={explicacion}
          onChange={(e) => setExplicacion(e.target.value)}
          rows={6}
          disabled={isPending}
          style={{ ...textareaStyle, minHeight: 140 }}
        />
      </Field>

      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <button
          onClick={handleSubmit}
          disabled={isPending}
          style={btnPrimary}
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Guardar cambios
        </button>
      </div>
    </div>
  )
}

/**
 * Toggle estilo card grande para elegir entre FREE / PRO. Dos botones
 * exclusivos (radio behavior). Cuando uno está seleccionado se ilumina
 * con su color semántico (verde=FREE, naranja=PRO).
 */
function TierToggle({ value, current, onChange, disabled, label, description, icon, color }: {
  value:       Tier
  current:     Tier
  onChange:    (v: Tier) => void
  disabled:    boolean
  label:       string
  description: string
  icon:        React.ReactNode
  color:       "green" | "orange"
}) {
  const active = current === value
  const accent = color === "green" ? "var(--green-d)" : "var(--orange-600)"
  const bg     = color === "green" ? "rgba(34, 197, 94, 0.10)" : "rgba(234, 88, 12, 0.10)"
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={() => onChange(value)}
      disabled={disabled}
      style={{
        flex:         1,
        padding:      "10px 12px",
        borderRadius: 10,
        border:       active ? `2px solid ${accent}` : "1.5px solid var(--slate-200)",
        background:   active ? bg : "#fff",
        cursor:       disabled ? "not-allowed" : "pointer",
        opacity:      disabled ? 0.6 : 1,
        textAlign:    "left",
        display:      "flex",
        flexDirection: "column",
        gap:          4,
        transition:   "border-color 0.15s, background 0.15s",
      }}
    >
      <div style={{
        display:     "flex",
        alignItems:  "center",
        gap:         6,
        fontSize:    13,
        fontWeight:  700,
        color:       active ? accent : "var(--slate-700)",
      }}>
        {icon}
        {label}
        <span
          className="font-mono-tabular"
          style={{
            marginLeft:   "auto",
            fontSize:     10,
            fontWeight:   800,
            padding:      "1px 6px",
            borderRadius: 4,
            background:   active ? accent : "var(--slate-100)",
            color:        active ? "#fff" : "var(--slate-500)",
          }}
        >
          {value}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--slate-500)" }}>
        {description}
      </div>
    </button>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{
        display:       "block",
        fontSize:      11,
        fontWeight:    700,
        color:         "var(--slate-500)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        marginBottom:  6,
      }}>
        {label}
      </label>
      {children}
      {hint && (
        <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "var(--slate-400)" }}>
          {hint}
        </p>
      )}
    </div>
  )
}

const textareaStyle: React.CSSProperties = {
  width:      "100%",
  padding:    "10px 12px",
  borderRadius: 8,
  border:     "1.5px solid var(--slate-200)",
  fontSize:   14,
  fontFamily: "inherit",
  lineHeight: 1.5,
  resize:     "vertical",
  outline:    "none",
}

const inputStyle: React.CSSProperties = {
  width:      "100%",
  padding:    "8px 12px",
  borderRadius: 8,
  border:     "1.5px solid var(--slate-200)",
  fontSize:   13.5,
  fontFamily: "inherit",
  outline:    "none",
}

const btnPrimary: React.CSSProperties = {
  padding:      "10px 18px",
  borderRadius: 8,
  border:       0,
  background:   "var(--orange-600)",
  color:        "white",
  fontWeight:   700,
  fontSize:     14,
  cursor:       "pointer",
  display:      "inline-flex",
  alignItems:   "center",
  gap:          8,
}
