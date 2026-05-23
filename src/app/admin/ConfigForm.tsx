"use client"

import { useState, useTransition } from "react"
import { Check, Loader2, X, Sparkles, Zap, Brain, Cpu, CheckCircle2 } from "lucide-react"
import { updateConfigAction } from "./actions"
import type { ConfigEntry, ConfigOption } from "@/lib/configCatalog"

/** Mapping de iconHint → componente Lucide para variant 'cards'. */
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  sparkles: Sparkles,
  zap:      Zap,
  brain:    Brain,
  cpu:      Cpu,
}

interface Props {
  entry:   ConfigEntry
  current: number | boolean | string
}

/**
 * Form pequeño per-entrada que envía la Server Action.
 * Muestra estado pending / success / error.
 */
export function ConfigForm({ entry, current }: Props) {
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle")
  const [error, setError]   = useState<string | null>(null)

  async function onSubmit(formData: FormData) {
    setStatus("idle")
    setError(null)
    startTransition(async () => {
      try {
        const res = await updateConfigAction(formData)
        if (res.ok) {
          setStatus("success")
          // Auto-hide success after 2s
          setTimeout(() => setStatus("idle"), 2000)
        } else {
          setStatus("error")
          setError(res.error)
        }
      } catch (err) {
        setStatus("error")
        setError(err instanceof Error ? err.message : "Error desconocido")
      }
    })
  }

  return (
    <form action={onSubmit}>
      <input type="hidden" name="key" value={entry.key} />

      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
        <label htmlFor={`field-${entry.key}`} style={{ fontWeight: 700, fontSize: 14 }}>
          {entry.label}
          <span className="font-mono-tabular" style={{ marginLeft: 8, fontSize: 11, color: "var(--slate-400)", fontWeight: 500 }}>
            {entry.key}
          </span>
        </label>
        {entry.description && (
          <small style={{ color: "var(--slate-500)", fontSize: 12.5, lineHeight: 1.45 }}>
            {entry.description}
          </small>
        )}
      </div>

      {/*
        En mobile el field (select / textarea / radio cards) + el botón
        Guardar no caben en una fila — el Guardar se desbordaba. Solución:
        stack vertical en mobile, fila en sm+ (igual que desktop).
        El botón Guardar lleva self-start en mobile para alinear a la izq.
      */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-2.5">
        {entry.options && entry.options.length > 0 && entry.optionVariant === "cards" ? (
          <CardsField
            entryKey={entry.key}
            options={entry.options}
            defaultValue={String(current)}
            disabled={isPending}
          />
        ) : entry.options && entry.options.length > 0 ? (
          <SelectField
            entryKey={entry.key}
            options={entry.options}
            defaultValue={String(current)}
            disabled={isPending}
          />
        ) : entry.type === "boolean" ? (
          <BooleanToggle name="value" defaultChecked={Boolean(current)} disabled={isPending} />
        ) : entry.type === "number" ? (
          <input
            id={`field-${entry.key}`}
            name="value"
            type="number"
            defaultValue={String(current)}
            disabled={isPending}
            style={inputStyle}
          />
        ) : (
          <textarea
            id={`field-${entry.key}`}
            name="value"
            defaultValue={String(current)}
            disabled={isPending}
            rows={3}
            style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
          />
        )}

        <button
          type="submit"
          disabled={isPending}
          className="self-start sm:self-auto"
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: 0,
            background: "var(--orange-600)",
            color: "white",
            fontWeight: 700,
            fontSize: 13,
            cursor: isPending ? "wait" : "pointer",
            opacity: isPending ? 0.6 : 1,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
          }}
        >
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {!isPending && status === "success" && <Check className="h-3.5 w-3.5" />}
          {!isPending && status === "error"   && <X className="h-3.5 w-3.5" />}
          Guardar
        </button>
      </div>

      {error && (
        <p style={{ marginTop: 6, fontSize: 12, color: "var(--red-600)" }}>
          {error}
        </p>
      )}
    </form>
  )
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 12px",
  borderRadius: 8,
  border: "1.5px solid var(--slate-200)",
  fontSize: 14,
  outline: "none",
  background: "#fff",
  fontFamily: "inherit",
}

/**
 * Dropdown con descripción dinámica del valor seleccionado. La descripción
 * vive en el propio array de options (cada opción la trae). Cambia al
 * vuelo cuando el usuario abre el select y elige otra entrada — sin
 * necesidad de submit. Solo se persiste al pulsar "Guardar".
 */
function SelectField({
  entryKey,
  options,
  defaultValue,
  disabled,
}: {
  entryKey:     string
  options:      ConfigOption[]
  defaultValue: string
  disabled:     boolean
}) {
  const initial = options.find((o) => o.value === defaultValue) ?? options[0]
  const [selected, setSelected] = useState<string>(initial.value)
  const description = options.find((o) => o.value === selected)?.description
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
      <select
        id={`field-${entryKey}`}
        name="value"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        disabled={disabled}
        style={{
          ...inputStyle,
          flex:    "none",
          padding: "8px 12px",
          cursor:  disabled ? "not-allowed" : "pointer",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {/* Valor desconocido (alguien tocó la BBDD a mano con un valor que
            no está en el catálogo) — lo añadimos como opción extra para
            no perderlo silenciosamente. */}
        {!options.some((o) => o.value === defaultValue) && (
          <option value={defaultValue}>
            {defaultValue} (valor personalizado)
          </option>
        )}
      </select>
      {description && (
        <small
          style={{
            fontSize:   12,
            color:      "var(--slate-500)",
            lineHeight: 1.45,
            paddingLeft: 2,
          }}
        >
          {description}
        </small>
      )}
    </div>
  )
}

/**
 * Selector visual tipo radio con cards horizontales (icono + título +
 * subtitle). Ideal para 2-4 opciones donde quieres que el admin compare
 * de un vistazo (p.ej. proveedor de IA).
 *
 * La descripción larga de la opción seleccionada aparece como "footer"
 * debajo del grupo de cards, igual que en SelectField.
 */
function CardsField({
  entryKey,
  options,
  defaultValue,
  disabled,
}: {
  entryKey:     string
  options:      ConfigOption[]
  defaultValue: string
  disabled:     boolean
}) {
  const initial = options.find((o) => o.value === defaultValue) ?? options[0]
  const [selected, setSelected] = useState<string>(initial.value)
  const selectedOpt = options.find((o) => o.value === selected)

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Input hidden con el value real que envía el form */}
      <input type="hidden" name="value" value={selected} />

      {/* Grid de cards */}
      <div
        style={{
          display:             "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap:                 10,
        }}
        role="radiogroup"
        aria-labelledby={`field-${entryKey}-label`}
      >
        {options.map((o) => {
          const isSelected = o.value === selected
          const Icon       = o.iconHint ? ICON_MAP[o.iconHint] : null
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => setSelected(o.value)}
              style={{
                display:        "flex",
                alignItems:     "center",
                gap:            12,
                padding:        "12px 14px",
                borderRadius:   12,
                background:     isSelected ? "rgba(59, 130, 246, 0.06)" : "#fff",
                border:         isSelected
                                  ? "1.5px solid rgba(59, 130, 246, 0.55)"
                                  : "1.5px solid var(--slate-200)",
                cursor:         disabled ? "not-allowed" : "pointer",
                textAlign:      "left",
                transition:     "background 0.15s, border-color 0.15s",
                position:       "relative",
              }}
            >
              {Icon && (
                <span
                  style={{
                    width:        36,
                    height:       36,
                    borderRadius: 10,
                    display:      "inline-flex",
                    alignItems:   "center",
                    justifyContent: "center",
                    background:   isSelected
                                    ? "rgba(59, 130, 246, 0.15)"
                                    : "var(--slate-100)",
                    color:        isSelected ? "rgb(29, 78, 216)" : "var(--slate-500)",
                    flexShrink:   0,
                  }}
                >
                  <Icon className="h-5 w-5" />
                </span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize:   14.5,
                    color:      isSelected ? "rgb(29, 78, 216)" : "var(--ink)",
                    lineHeight: 1.3,
                  }}
                >
                  {o.label}
                </div>
                {o.subtitle && (
                  <div
                    style={{
                      fontSize:   12,
                      color:      "var(--slate-500)",
                      marginTop:  2,
                      lineHeight: 1.3,
                    }}
                  >
                    {o.subtitle}
                  </div>
                )}
              </div>
              {isSelected && (
                <CheckCircle2
                  className="h-5 w-5"
                  style={{ color: "rgb(29, 78, 216)", flexShrink: 0 }}
                />
              )}
            </button>
          )
        })}
        {/* Si el valor en BBDD es desconocido (alguien editó a mano),
            lo mostramos como card extra para no perderlo silenciosamente. */}
        {!options.some((o) => o.value === defaultValue) && (
          <div
            style={{
              padding:      "12px 14px",
              borderRadius: 12,
              background:   "rgba(245, 158, 11, 0.08)",
              border:       "1.5px dashed rgba(245, 158, 11, 0.40)",
              fontSize:     13,
              color:        "var(--amber-d)",
            }}
          >
            Valor desconocido en BBDD: <b>{defaultValue}</b>
            <br />
            <small>Selecciona una opción válida arriba para sobreescribirlo.</small>
          </div>
        )}
      </div>

      {/* Descripción larga de la opción seleccionada */}
      {selectedOpt?.description && (
        <small
          style={{
            fontSize:   12,
            color:      "var(--slate-500)",
            lineHeight: 1.5,
            paddingLeft: 2,
          }}
        >
          {selectedOpt.description}
        </small>
      )}
    </div>
  )
}

function BooleanToggle({ name, defaultChecked, disabled }: { name: string; defaultChecked: boolean; disabled: boolean }) {
  const [on, setOn] = useState(defaultChecked)
  return (
    <>
      <input type="hidden" name={name} value={on ? "true" : "false"} />
      <button
        type="button"
        onClick={() => setOn((v) => !v)}
        disabled={disabled}
        style={{
          width: 52, height: 28,
          borderRadius: 999,
          border: 0,
          background: on ? "var(--green)" : "var(--slate-300)",
          position: "relative",
          cursor: disabled ? "not-allowed" : "pointer",
          transition: "background 0.15s",
          flexShrink: 0,
        }}
        aria-pressed={on}
        aria-label={on ? "Activado" : "Desactivado"}
      >
        <span style={{
          position: "absolute",
          top: 3, left: on ? 27 : 3,
          width: 22, height: 22,
          borderRadius: "50%",
          background: "white",
          transition: "left 0.15s",
        }} />
      </button>
      <span style={{ fontSize: 13, fontWeight: 600, color: on ? "var(--green-d)" : "var(--slate-500)", minWidth: 50 }}>
        {on ? "Activado" : "Desactivado"}
      </span>
    </>
  )
}
