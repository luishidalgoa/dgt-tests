"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sparkles,
  Crown,
  Check,
  Loader2,
  ArrowRight,
} from "lucide-react"

interface Props {
  /** Id de la notificación (siempre "welcome-v1" por ahora). */
  notificationId: string
  /** displayName para personalizar el saludo. */
  username:       string
}

const FREE_HIGHLIGHTS = [
  "7 primeros tests de Permiso B",
  "Modo práctica con feedback",
  "Modo examen real (30 min)",
  "Historial + estadísticas",
  "10 análisis IA al mes",
]

const PRO_HIGHLIGHTS = [
  "Todas las categorías (+100 tests)",
  "Tests por tema + test de errores",
  "Manual completo en flipbook",
  "Modo competición multijugador",
  "50 análisis IA al mes",
]

export function WelcomeModal({ notificationId, username }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loadingPro, setLoadingPro] = useState(false)
  const [errorPro, setErrorPro] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Pequeño delay para no saltar a la cara
  useEffect(() => {
    const t = setTimeout(() => setOpen(true), 250)
    return () => clearTimeout(t)
  }, [])

  async function dismiss() {
    setOpen(false)
    startTransition(async () => {
      try {
        await fetch("/api/users/me/ack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: notificationId }),
        })
        router.refresh()
      } catch {
        // ignore
      }
    })
  }

  async function chooseFree() {
    await dismiss()
  }

  async function choosePro() {
    setErrorPro(null)
    setLoadingPro(true)
    try {
      const res = await fetch("/api/checkout/session", { method: "POST" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? "No se pudo iniciar el checkout")
      }
      const { url } = (await res.json()) as { url: string }
      if (!url) throw new Error("Sin url de Stripe")
      // Marcamos ack ANTES de redirigir
      try {
        await fetch("/api/users/me/ack", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ key: notificationId }),
        })
      } catch {}
      window.location.href = url
    } catch (err) {
      setErrorPro(err instanceof Error ? err.message : "Error desconocido")
      setLoadingPro(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss() }}>
      <DialogContent className="!max-w-[min(94vw,720px)] !w-[min(94vw,720px)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" style={{ color: "var(--amber)" }} />
            ¡Bienvenido, {username}! 🚗
          </DialogTitle>
          <DialogDescription>
            Para empezar, elige cómo quieres usar DGT Tests. Puedes cambiar de plan en cualquier momento.
          </DialogDescription>
        </DialogHeader>

        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            marginTop: 10,
          }}
        >
          {/* FREE */}
          <section
            style={{
              padding: 18,
              borderRadius: 14,
              border: "1.5px solid var(--slate-200)",
              background: "#fff",
            }}
          >
            <div style={{ fontSize: 11.5, color: "var(--slate-500)", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
              Plan gratis
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 12 }}>
              <span className="font-mono-tabular" style={{ fontSize: 28, fontWeight: 900, letterSpacing: "-0.02em" }}>
                0€
              </span>
              <span style={{ fontSize: 13, color: "var(--slate-500)" }}>/ mes</span>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
              {FREE_HIGHLIGHTS.map((f) => (
                <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: "var(--slate-700)" }}>
                  <Check className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" style={{ color: "var(--green)" }} />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={chooseFree}
              disabled={isPending || loadingPro}
              className="btn-secondary"
              style={{ marginTop: 16, width: "100%", justifyContent: "center" }}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Continuando...
                </>
              ) : (
                <>Continuar gratis</>
              )}
            </button>
          </section>

          {/* PRO */}
          <section
            style={{
              padding: 18,
              borderRadius: 14,
              border: "1.5px solid rgba(168, 85, 247, 0.40)",
              background:
                "linear-gradient(135deg, rgba(168, 85, 247, 0.06), rgba(236, 72, 153, 0.04))",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: -10,
                right: 14,
                padding: "3px 9px",
                borderRadius: 999,
                background: "linear-gradient(135deg, rgb(168, 85, 247), rgb(236, 72, 153))",
                color: "#fff",
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Recomendado
            </div>
            <div style={{ fontSize: 11.5, color: "rgb(126, 34, 206)", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
              <Crown className="h-3.5 w-3.5" /> Plan PRO
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 12 }}>
              <span
                className="font-mono-tabular"
                style={{
                  fontSize: 28,
                  fontWeight: 900,
                  letterSpacing: "-0.02em",
                  background: "linear-gradient(135deg, rgb(168, 85, 247), rgb(236, 72, 153))",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                5€
              </span>
              <span style={{ fontSize: 13, color: "var(--slate-500)" }}>/ mes</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--slate-600)", marginBottom: 8, fontStyle: "italic" }}>
              Todo lo del plan gratuito, más:
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
              {PRO_HIGHLIGHTS.map((f) => (
                <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: "var(--slate-700)" }}>
                  <Check className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" style={{ color: "var(--green)" }} />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={choosePro}
              disabled={loadingPro || isPending}
              className="inline-flex items-center justify-center gap-2"
              style={{
                marginTop: 16,
                width: "100%",
                padding: "10px 14px",
                borderRadius: 10,
                border: 0,
                background:
                  "linear-gradient(135deg, rgb(168, 85, 247), rgb(236, 72, 153))",
                color: "#fff",
                fontWeight: 800,
                fontSize: 13.5,
                cursor: loadingPro ? "wait" : "pointer",
                boxShadow: "0 10px 22px -10px rgba(168, 85, 247, 0.55)",
                opacity: loadingPro ? 0.7 : 1,
              }}
            >
              {loadingPro ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Abriendo Stripe...
                </>
              ) : (
                <>
                  <Crown className="h-4 w-4" />
                  Suscribirme
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
            {errorPro && (
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
                {errorPro}
              </p>
            )}
          </section>
        </div>

        <p
          style={{
            marginTop: 12,
            marginBottom: 0,
            textAlign: "center",
            fontSize: 11.5,
            color: "var(--slate-400)",
          }}
        >
          Pago seguro con Stripe · Cancela cuando quieras desde Configuración
        </p>
      </DialogContent>
    </Dialog>
  )
}
