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

  const intentosLabel = `${credits} ${credits === 1 ? "intento" : "intentos"}`
  // Tooltip explicativo: por qué solo aparece hoy y cuándo se ganan más.
  const tooltip =
    `Solo puedes restaurar la racha el día siguiente a haberse roto. ` +
    `Tienes ${intentosLabel} restante${credits === 1 ? "" : "s"} — ` +
    `ganas +1 cada 7 días seguidos (máximo 5).`

  return (
    <div
      style={{
        display:       "flex",
        flexDirection: "column",
        gap:           4,
        marginTop:     12,
        marginBottom:  18,
      }}
    >
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        aria-label={`Restaurar racha rota — ${intentosLabel} restante${credits === 1 ? "" : "s"}`}
        title={tooltip}
        className="restore-streak-btn"
        style={{
          display:        "inline-flex",
          alignItems:     "center",
          gap:            8,
          padding:        "8px 14px",
          borderRadius:   10,
          border:         "1px solid var(--orange-500)",
          background:     "linear-gradient(180deg, #fff, #fff7ed)",
          color:          "var(--orange-600)",
          fontWeight:     700,
          fontSize:       13,
          cursor:         isPending ? "wait" : "pointer",
          alignSelf:      "flex-start",
        }}
      >
        {isPending
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : <RefreshCw className="h-4 w-4 refresh-icon" />}
        <span>Restaurar racha</span>
        <span
          style={{
            display:       "inline-flex",
            alignItems:    "center",
            padding:       "1px 8px",
            borderRadius:  999,
            background:    "var(--orange-500)",
            color:         "#fff",
            fontSize:      11.5,
            fontWeight:    800,
            letterSpacing: "0.02em",
          }}
        >
          {intentosLabel}
        </span>
      </button>
      {error && (
        <span
          role="alert"
          style={{ fontSize: 12, color: "var(--red-500)", fontWeight: 600 }}
        >
          {error}
        </span>
      )}
    </div>
  )
}
