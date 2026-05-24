"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, RefreshCw } from "lucide-react"
import { restoreStreakAction } from "@/app/actions/streak"

interface Props {
  credits: number
}

/**
 * Botón "Restaurar racha (X)" del dashboard.
 *
 * Se renderiza solo si el padre (page.tsx) ha calculado `canRestore=true`
 * — este componente no decide eligibilidad, solo presenta la acción.
 *
 * Llamada → server action `restoreStreakAction` → revalidatePath("/").
 * En cliente forzamos también `router.refresh()` para que el re-render
 * se vea inmediato (Next a veces no propaga el revalidate al
 * dynamic-segment activo si el navegador ya tiene el HTML cacheado).
 */
export function RestoreStreakButton({ credits }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await restoreStreakAction()
        if (!res.ok) {
          setError(res.error)
          return
        }
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error desconocido")
      }
    })
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        aria-label={`Restaurar racha rota — te quedan ${credits} ${credits === 1 ? "crédito" : "créditos"}`}
        style={{
          display:        "inline-flex",
          alignItems:     "center",
          gap:            6,
          padding:        "6px 12px",
          borderRadius:   8,
          border:         "1px solid rgba(255,255,255,0.35)",
          background:     "rgba(255,255,255,0.18)",
          color:          "#fff",
          fontWeight:     700,
          fontSize:       13,
          cursor:         isPending ? "wait" : "pointer",
          alignSelf:      "flex-start",
          transition:     "background 0.15s",
        }}
      >
        {isPending
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : <RefreshCw className="h-4 w-4" />}
        Restaurar racha ({credits})
      </button>
      {error && (
        <span
          role="alert"
          style={{ fontSize: 12, color: "#fee2e2", fontWeight: 600 }}
        >
          {error}
        </span>
      )}
    </div>
  )
}
