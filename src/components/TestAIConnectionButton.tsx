"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Loader2, Plug, CheckCircle2, XCircle } from "lucide-react"
import { apiFetch } from "@/lib/apiClient"

interface Props {
  provider:  "gemini" | "groq"
  /** Texto legible del proveedor para los toasts. */
  label:     string
}

type PingResult =
  | { ok: true;  latencyMs: number; model: string }
  | { ok: false; error: string }

/**
 * Botón "Probar conexión" para una API key de IA. Llama al endpoint
 * /api/admin/test-ai-connection y muestra el resultado vía toasts de
 * sonner — éxito en verde con latencia y modelo, fallo en rojo con
 * el mensaje exacto.
 *
 * Se renderiza en /admin/secrets debajo de cada API key de IA (GEMINI,
 * GROQ). Usa el modelo configurado en CONFIG_CATALOG, así que también
 * sirve para probar combinaciones key+modelo distintas sin redeploy.
 */
export function TestAIConnectionButton({ provider, label }: Props) {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    try {
      const res = await apiFetch("/api/admin/test-ai-connection", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ provider }),
      })
      const data = (await res.json()) as PingResult | { error: string }
      if (!res.ok || !("ok" in data)) {
        const msg = "error" in data ? data.error : `HTTP ${res.status}`
        toast.error(`${label}: error inesperado`, { description: msg, duration: 8000 })
        return
      }
      if (data.ok) {
        toast.success(`${label}: conexión OK`, {
          description: `Modelo ${data.model} · ${data.latencyMs} ms`,
          duration:    5000,
        })
      } else {
        toast.error(`${label}: conexión fallida`, {
          description: data.error,
          duration:    9000,
        })
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
      title="Hace una llamada minimal al modelo para verificar API key + modelo"
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Plug className="h-3.5 w-3.5" />
      )}
      {loading ? "Probando..." : "Probar conexión"}
    </button>
  )
}

// Iconos exportados por si alguien quiere reusarlos en otro sitio
export { CheckCircle2 as ConnectionOkIcon, XCircle as ConnectionFailIcon }
