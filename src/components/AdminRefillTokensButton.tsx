"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Shield, Check } from "lucide-react"
import { AI_QUOTA_CHANGED_EVENT, type MonthlyQuota } from "@/components/AIExplainPanel"
import { apiFetch } from "@/lib/apiClient"

export function AdminRefillTokensButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [done, setDone]       = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [, startTransition]   = useTransition()

  async function refill() {
    setError(null)
    setDone(false)
    setLoading(true)
    try {
      const res = await apiFetch("/api/users/me/refill-tokens", { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Error al recargar tokens")
      // Emite evento para que el chip del navbar se refresque en vivo
      const quota = data.quota as MonthlyQuota | undefined
      if (quota) {
        window.dispatchEvent(new CustomEvent(AI_QUOTA_CHANGED_EVENT, { detail: quota }))
      }
      setDone(true)
      // Refresca el server-render del layout/settings para que los demás
      // sitios que muestran la quota también se actualicen
      startTransition(() => router.refresh())
      setTimeout(() => setDone(false), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={refill}
        disabled={loading}
        className="inline-flex items-center justify-center gap-2"
        style={{
          marginTop: 12,
          width: "100%",
          padding: "10px 14px",
          borderRadius: 10,
          border: 0,
          background: done
            ? "linear-gradient(135deg, var(--green), var(--green-d))"
            : "linear-gradient(135deg, #facc15, #ea580c)",
          color: "#fff",
          fontSize: 13,
          fontWeight: 800,
          cursor: loading ? "wait" : "pointer",
          opacity: loading ? 0.7 : 1,
          boxShadow: "0 8px 18px -10px rgba(234, 88, 12, 0.55)",
          transition: "background 0.2s",
        }}
      >
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Recargando...
          </>
        ) : done ? (
          <>
            <Check className="h-3.5 w-3.5" />
            ¡Tokens recargados!
          </>
        ) : (
          <>
            <Shield className="h-3.5 w-3.5" />
            Recargar tokens (admin)
          </>
        )}
      </button>
      {error && (
        <p
          style={{
            marginTop: 8,
            padding: "6px 8px",
            borderRadius: 6,
            background: "rgba(239, 68, 68, 0.08)",
            border: "1px solid rgba(239, 68, 68, 0.30)",
            color: "var(--red-600)",
            fontSize: 11.5,
          }}
        >
          {error}
        </p>
      )}
    </>
  )
}
