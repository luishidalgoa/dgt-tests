"use client"

import { useState, useTransition } from "react"
import { Check, Loader2, Trash2, X } from "lucide-react"
import { updateSecretAction, deleteSecretAction } from "./actions"

interface Props {
  secretKey: string
  hasValue:  boolean
}

/**
 * Form per-secret:
 *   - Input password (oculto por defecto, toggleable)
 *   - Botón Guardar → updateSecretAction
 *   - Si ya hay valor en DB, también botón Borrar → deleteSecretAction
 *
 * Estado pending/success/error inline.
 */
export function SecretForm({ secretKey, hasValue }: Props) {
  const [isPending, startTransition]   = useTransition()
  const [status, setStatus]            = useState<"idle" | "success" | "error">("idle")
  const [error, setError]              = useState<string | null>(null)
  const [showValue, setShowValue]      = useState(false)
  const [confirmingDelete, setConfDel] = useState(false)

  async function handleSubmit(formData: FormData) {
    setStatus("idle"); setError(null)
    startTransition(async () => {
      try {
        const res = await updateSecretAction(formData)
        if (res.ok) {
          setStatus("success")
          setTimeout(() => setStatus("idle"), 2500)
        } else {
          setStatus("error"); setError(res.error)
        }
      } catch (err) {
        setStatus("error"); setError(err instanceof Error ? err.message : "Error")
      }
    })
  }

  async function handleDelete() {
    if (!confirmingDelete) {
      setConfDel(true)
      setTimeout(() => setConfDel(false), 4000)
      return
    }
    setConfDel(false)
    setStatus("idle"); setError(null)
    const f = new FormData()
    f.set("key", secretKey)
    startTransition(async () => {
      try {
        const res = await deleteSecretAction(f)
        if (res.ok) {
          setStatus("success")
          setTimeout(() => setStatus("idle"), 2500)
        } else {
          setStatus("error"); setError(res.error)
        }
      } catch (err) {
        setStatus("error"); setError(err instanceof Error ? err.message : "Error")
      }
    })
  }

  return (
    <>
      {/*
        En mobile el input + los 3 botones (Ver / Guardar / Trash) no
        caben en una fila — el último botón se desbordaba ~16px. Solución:
        input arriba en su propia fila, botones en fila aparte debajo.
        En sm+ vuelven todos a una sola fila (igual que desktop).
      */}
      <form action={handleSubmit} className="flex flex-col sm:flex-row gap-2 sm:items-stretch">
        <input type="hidden" name="key" value={secretKey} />
        <input
          name="value"
          type={showValue ? "text" : "password"}
          placeholder={hasValue ? "Pega nuevo valor para reemplazar…" : "Pega el secreto aquí…"}
          autoComplete="off"
          disabled={isPending}
          className="flex-1 min-w-0"
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1.5px solid var(--slate-200)",
            fontSize: 13,
            outline: "none",
            background: "#fff",
            fontFamily: "monospace",
          }}
        />
        {/* Grupo de botones: siempre en fila, gap pequeño. En mobile va
            debajo del input por el flex-col del form. */}
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowValue(v => !v)}
            disabled={isPending}
            title={showValue ? "Ocultar" : "Mostrar"}
            style={{
              padding: "0 12px",
              borderRadius: 8,
              border: "1.5px solid var(--slate-200)",
              background: "#fff",
              color: "var(--slate-500)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {showValue ? "Ocultar" : "Ver"}
          </button>
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
          {hasValue && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              title={confirmingDelete ? "Click otra vez para confirmar" : "Borrar override (vuelve al env)"}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: 0,
                background: confirmingDelete ? "var(--red-600)" : "rgba(239, 68, 68, 0.12)",
                color: confirmingDelete ? "white" : "var(--red-600)",
                fontWeight: 700,
                fontSize: 13,
                cursor: isPending ? "wait" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {confirmingDelete ? "Confirmar" : ""}
            </button>
          )}
        </div>
      </form>

      {error && (
        <p style={{ marginTop: 6, fontSize: 12, color: "var(--red-600)" }}>
          {error}
        </p>
      )}
    </>
  )
}
