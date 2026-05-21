"use client"

import { useState } from "react"
import { Loader2, Crown } from "lucide-react"

export function CheckoutButton() {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function handleCheckout() {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/checkout/session", { method: "POST" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? "No se pudo iniciar el checkout")
      }
      const { url } = (await res.json()) as { url: string }
      if (!url) throw new Error("Respuesta del servidor sin url de Stripe")
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
        onClick={handleCheckout}
        disabled={loading}
        className="inline-flex items-center justify-center gap-2"
        style={{
          marginTop: 22,
          width: "100%",
          padding: "12px",
          borderRadius: 10,
          border: 0,
          background:
            "linear-gradient(135deg, rgb(168, 85, 247), rgb(236, 72, 153))",
          color: "#fff",
          fontSize: 14,
          fontWeight: 800,
          cursor: loading ? "wait" : "pointer",
          boxShadow: "0 10px 22px -10px rgba(168, 85, 247, 0.55)",
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Redirigiendo a Stripe...
          </>
        ) : (
          <>
            <Crown className="h-4 w-4" />
            Suscribirme · 5€/mes
          </>
        )}
      </button>
      {error && (
        <p
          style={{
            marginTop: 10,
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
