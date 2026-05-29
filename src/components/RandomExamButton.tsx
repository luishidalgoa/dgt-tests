"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Dices, Loader2 } from "lucide-react"
import { toast } from "sonner"

/**
 * Botón "Examen aleatorio". Pide al servidor (`/api/random`) un test al
 * azar que el usuario PUEDE abrir y navega a él vía client-side routing
 * (SPA). La elección y el filtro de permisos ocurren en el servidor, así
 * que el cliente nunca recibe un destino bloqueado.
 *
 *   - Sin `categoria`  → elige de cualquier categoría (botón global de
 *     la home: "para no tener que elegir categoría").
 *   - Con `categoria`  → elige solo dentro de esa categoría (botón del
 *     header de `/[categoria]`).
 *
 * Estados: mientras resuelve muestra "Eligiendo…" con spinner; si el
 * servidor no encuentra ninguno o falla la red, avisa con un toast y
 * vuelve a su estado normal.
 */

interface Props {
  /** Slug de categoría para acotar la elección. Omitir = global. */
  categoria?: string
  /** Texto del botón. */
  label?: string
  /** "solid" = destacado (home); "ghost" = discreto (header categoría). */
  variant?: "solid" | "ghost"
}

export function RandomExamButton({ categoria, label = "Aleatorio", variant = "ghost" }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [isPending, startTransition] = useTransition()

  async function handleClick() {
    if (loading || isPending) return
    setLoading(true)
    try {
      const qs = categoria ? `?categoria=${encodeURIComponent(categoria)}` : ""
      const res  = await fetch(`/api/random${qs}`, { cache: "no-store" })
      const data = (await res.json().catch(() => ({}))) as { href?: string | null }
      if (res.ok && data.href) {
        // No reseteamos `loading`: la navegación desmonta el botón. Dejar
        // el spinner evita un parpadeo de "Aleatorio" antes de salir.
        startTransition(() => router.push(data.href as string))
        return
      }
      toast.error(
        categoria
          ? "No hay exámenes disponibles en esta categoría"
          : "No hay exámenes disponibles ahora mismo",
      )
    } catch {
      toast.error("No se pudo elegir un examen aleatorio")
    }
    setLoading(false)
  }

  const busy = loading || isPending
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className={`random-btn${variant === "solid" ? " is-solid" : ""}`}
      aria-label={
        categoria
          ? "Abrir un examen aleatorio de esta categoría"
          : "Abrir un examen aleatorio de cualquier categoría"
      }
      title={
        categoria
          ? "Abre un test al azar de esta categoría"
          : "Abre un test al azar de cualquier categoría"
      }
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Dices className="h-4 w-4" />}
      <span>{busy ? "Eligiendo…" : label}</span>
    </button>
  )
}
