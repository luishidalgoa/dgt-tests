"use client"

import { useState, useTransition } from "react"
import { Check, Loader2, X } from "lucide-react"
import { updateConfigAction } from "./actions"
import type { ConfigEntry } from "@/lib/configCatalog"

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

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {entry.type === "boolean" ? (
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
