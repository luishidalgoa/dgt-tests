"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Trash2, Loader2 } from "lucide-react"

interface Props {
  attemptId: number
  label?:    string  // descripción corta para el confirm, p.ej. "Test 3 · Permiso B"
}

/**
 * Botón "borrar" para un attempt. Solo se renderiza si el padre considera
 * que el user debe verlo (típicamente isAdmin === true).
 *
 * Lleva su propio confirm + estado pending. Cuando el DELETE responde
 * OK, refresca el server component padre con router.refresh() para que
 * desaparezca el row sin recargar la página entera.
 *
 * El click NO debe llegar al <Link> que envuelve el row — el padre se
 * encarga de no anidarlo dentro del enlace.
 */
export function DeleteAttemptButton({ attemptId, label }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error,     setError]        = useState<string | null>(null)

  function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const ok = window.confirm(
      label
        ? `¿Borrar "${label}" del historial?\nEsta acción no se puede deshacer.`
        : "¿Borrar este intento del historial?\nEsta acción no se puede deshacer."
    )
    if (!ok) return

    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/attempts/${attemptId}`, { method: "DELETE" })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? "No se pudo borrar el intento")
        }
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido")
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      title={error ?? "Borrar este intento del historial"}
      aria-label="Borrar intento"
      style={{
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        height: 36,
        borderRadius: 8,
        border: 0,
        background: error
          ? "rgba(239, 68, 68, 0.18)"
          : "rgba(148, 163, 184, 0.10)",
        color: error ? "var(--red-600)" : "var(--slate-500)",
        cursor: isPending ? "wait" : "pointer",
        transition: "background 0.15s, color 0.15s",
      }}
      onMouseEnter={(e) => {
        if (!isPending && !error) {
          e.currentTarget.style.background = "rgba(239, 68, 68, 0.12)"
          e.currentTarget.style.color = "var(--red-600)"
        }
      }}
      onMouseLeave={(e) => {
        if (!isPending && !error) {
          e.currentTarget.style.background = "rgba(148, 163, 184, 0.10)"
          e.currentTarget.style.color = "var(--slate-500)"
        }
      }}
    >
      {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
    </button>
  )
}
