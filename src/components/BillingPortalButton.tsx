"use client"

import { useState } from "react"
import { Loader2, CreditCard } from "lucide-react"

export function BillingPortalButton() {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function open() {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? "No se pudo abrir el portal")
      }
      const { url } = (await res.json()) as { url: string }
      if (!url) throw new Error("Respuesta sin url")
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido")
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={loading}
        className="btn-secondary"
        style={{ width: "100%", justifyContent: "center" }}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Abriendo portal...
          </>
        ) : (
          <>
            <CreditCard className="h-4 w-4" />
            Gestionar suscripción
          </>
        )}
      </button>
      {error && (
        <p
          style={{
            marginTop: 8,
            padding: "8px 10px",
            borderRadius: 8,
            background: "rgba(239, 68, 68, 0.08)",
            border: "1px solid rgba(239, 68, 68, 0.30)",
            color: "var(--red-600)",
            fontSize: 12,
          }}
        >
          {error}
        </p>
      )}
    </>
  )
}
