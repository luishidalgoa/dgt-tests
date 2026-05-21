"use client"

import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Mail,
  KeyRound,
  Sparkles,
  ArrowRight,
  Loader2,
} from "lucide-react"
import { ackNotification } from "@/lib/client-acks"

interface Props {
  notificationId: string
}

/**
 * Modal informativo "actualización de perfil" (mayo 2026):
 *   - Anunciamos campo email + cambio de contraseña
 *   - CTA "Ir a configuración" y "Más tarde"
 *
 * Cumple con la promesa "una sola vez en la vida del usuario": el ack se
 * persiste en servidor + localStorage (ver client-acks.ts).
 */
export function UserUpdateModal({ notificationId }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const t = setTimeout(() => setOpen(true), 250)
    return () => clearTimeout(t)
  }, [])

  async function dismiss() {
    setOpen(false)
    startTransition(async () => {
      await ackNotification(notificationId)
      router.refresh()
    })
  }

  async function goToSettings() {
    setOpen(false)
    await ackNotification(notificationId)
    router.push("/settings")
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss() }}>
      <DialogContent className="!max-w-[min(94vw,560px)] !w-[min(94vw,560px)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" style={{ color: "var(--amber)" }} />
            ¡Hemos mejorado tu cuenta!
          </DialogTitle>
          <DialogDescription>
            Mayo 2026 · Nuevas opciones disponibles en tu perfil
          </DialogDescription>
        </DialogHeader>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
          <Feature
            icon={<Mail className="h-4 w-4" />}
            title="Email (opcional)"
            body="Ahora puedes asociar un email a tu cuenta. Lo usaremos en el futuro para recuperar la contraseña y para avisos importantes. Nunca lo comparti­mos con terceros."
          />
          <Feature
            icon={<KeyRound className="h-4 w-4" />}
            title="Cambiar contraseña"
            body="Desde la sección Configuración puedes cambiar tu contraseña sin tener que crear una cuenta nueva."
          />
        </div>

        <p
          style={{
            marginTop: 14,
            marginBottom: 0,
            fontSize: 12.5,
            color: "var(--slate-500)",
            lineHeight: 1.55,
          }}
        >
          Rellenar estos campos es <b>opcional</b>. Tu cuenta sigue funcionando
          exactamente igual que antes si no haces nada.
        </p>

        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={dismiss}
            disabled={isPending}
            className="btn-secondary"
            style={{ minWidth: 120, justifyContent: "center" }}
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Más tarde"}
          </button>
          <button
            type="button"
            onClick={goToSettings}
            disabled={isPending}
            className="btn-primary"
            style={{ minWidth: 180, justifyContent: "center" }}
          >
            Ir a configuración
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: 12,
        borderRadius: 12,
        background: "rgba(249, 115, 22, 0.06)",
        border: "1px solid rgba(249, 115, 22, 0.20)",
      }}
    >
      <div
        className="flex items-center justify-center rounded-lg"
        style={{
          width: 32,
          height: 32,
          flexShrink: 0,
          background: "linear-gradient(135deg, var(--orange-400), var(--orange-600))",
          color: "#fff",
        }}
      >
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>{title}</div>
        <p style={{ margin: "2px 0 0", fontSize: 12.5, lineHeight: 1.5, color: "var(--slate-600)" }}>
          {body}
        </p>
      </div>
    </div>
  )
}
