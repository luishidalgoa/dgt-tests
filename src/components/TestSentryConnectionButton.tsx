"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Loader2, Plug, ExternalLink } from "lucide-react"
import { apiFetch } from "@/lib/apiClient"

interface Props {
  /** Texto legible para los toasts. */
  label?: string
}

type TestResult =
  | { ok: true;  eventId: string; mode: string; sentryUrl: string }
  | { ok: false; error: string }

/**
 * Botón "Probar conexión" para Sentry. Llama a /api/admin/test-sentry
 * con mode="capture" (envía una excepción a propósito) y muestra:
 *  - OK: toast verde con event ID + acción "Ver en Sentry" que abre
 *    la issue concreta.
 *  - Sentry no configurado (sin DSN): toast amarillo explicando que
 *    falta setup.
 *  - Error: toast rojo con el motivo.
 *
 * Se renderiza en /admin/secrets dentro del cajón "Sentry", en la card
 * del DSN. Funciona también si los demás secrets de Sentry (org/project/
 * auth_token) están vacíos, porque solo necesita el DSN para enviar.
 */
export function TestSentryConnectionButton({ label = "Sentry" }: Props) {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    try {
      const res = await apiFetch("/api/admin/test-sentry", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ mode: "capture" }),
      })
      const data = (await res.json()) as TestResult | { error: string }

      if (!res.ok || !("ok" in data)) {
        const msg = "error" in data ? data.error : `HTTP ${res.status}`
        toast.error(`${label}: error inesperado`, { description: msg, duration: 8000 })
        return
      }

      if (data.ok) {
        toast.success(`${label}: evento enviado correctamente`, {
          description: `eventId: ${data.eventId.slice(0, 8)}… · puede tardar ~10s en aparecer en el dashboard`,
          duration:    10000,
          action: {
            label:   "Ver en Sentry",
            onClick: () => window.open(data.sentryUrl, "_blank", "noopener,noreferrer"),
          },
        })
      } else {
        // Distinguir "no configurado" (típicamente DSN vacío) de error real
        const isNotConfigured = data.error.toLowerCase().includes("no inicializado") || data.error.toLowerCase().includes("dsn")
        if (isNotConfigured) {
          toast.warning(`${label}: no configurado`, {
            description: data.error,
            duration:    9000,
          })
        } else {
          toast.error(`${label}: fallo`, {
            description: data.error,
            duration:    9000,
          })
        }
      }
    } catch (err) {
      toast.error(`${label}: error de red`, {
        description: err instanceof Error ? err.message : String(err),
        duration:    8000,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      style={{
        display:        "inline-flex",
        alignItems:     "center",
        gap:            6,
        marginTop:      10,
        padding:        "6px 12px",
        borderRadius:   8,
        border:         "1px solid var(--slate-200)",
        background:     "#fff",
        fontSize:       12.5,
        fontWeight:     600,
        color:          "var(--slate-700)",
        cursor:         loading ? "wait" : "pointer",
        opacity:        loading ? 0.7 : 1,
      }}
      title="Envía una excepción a propósito a Sentry para verificar que la conexión funciona"
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Plug className="h-3.5 w-3.5" />
      )}
      {loading ? "Probando..." : "Probar conexión"}
      {!loading && <ExternalLink className="h-3 w-3" style={{ opacity: 0.5, marginLeft: 2 }} />}
    </button>
  )
}
