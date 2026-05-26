"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Loader2, Plug } from "lucide-react"
import { apiFetch } from "@/lib/apiClient"

interface Props {
  /** Texto legible para los toasts. */
  label?: string
}

type TestResult =
  | {
      ok:                  true
      latencyMs:           number
      bucket:              string
      endpoint:            string
      objectCount:         number | "unknown"
      publicUrlReachable:  boolean | null
    }
  | { ok: false; error: string }

/**
 * Botón "Probar conexión" para el grupo Cloudflare R2. Llama a
 * /api/admin/test-r2 que hace HeadBucket + ListObjects + (si hay URL
 * pública) HEAD a una key real para verificar que el bucket está
 * sirviendo como CDN.
 *
 * Se renderiza en /admin/secrets dentro del cajón "Cloudflare R2", en la
 * card del R2_SECRET_ACCESS_KEY (la "última" cred — punto natural para
 * verificar que todo el set funciona).
 */
export function TestR2ConnectionButton({ label = "R2" }: Props) {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    try {
      const res = await apiFetch("/api/admin/test-r2", { method: "POST" })
      const data = (await res.json()) as TestResult | { error: string }

      if (!res.ok || !("ok" in data)) {
        const msg = "error" in data ? data.error : `HTTP ${res.status}`
        toast.error(`${label}: error inesperado`, { description: msg, duration: 8000 })
        return
      }

      if (data.ok) {
        const objs = data.objectCount === "unknown"
          ? ""
          : ` · ${data.objectCount.toLocaleString("es-ES")} objs visibles`
        const cdn = data.publicUrlReachable === true
          ? " · CDN público OK"
          : data.publicUrlReachable === false
          ? " · ⚠ CDN público no responde"
          : ""
        toast.success(`${label}: conexión OK`, {
          description: `${data.bucket} · ${data.latencyMs} ms${objs}${cdn}`,
          duration:    6000,
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
        display:      "inline-flex",
        alignItems:   "center",
        gap:          6,
        marginTop:    10,
        padding:      "6px 12px",
        borderRadius: 8,
        border:       "1px solid var(--slate-200)",
        background:   "#fff",
        fontSize:     12.5,
        fontWeight:   600,
        color:        "var(--slate-700)",
        cursor:       loading ? "wait" : "pointer",
        opacity:      loading ? 0.7 : 1,
      }}
      title="Hace HeadBucket + ListObjects contra el endpoint S3 de R2 para verificar creds y bucket"
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
