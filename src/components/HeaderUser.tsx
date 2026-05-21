"use client"

import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { LogOut, Settings, Sparkles, Crown, Shield } from "lucide-react"
import { AI_QUOTA_CHANGED_EVENT, type MonthlyQuota } from "@/components/AIExplainPanel"

type Plan = "FREE" | "PRO" | "ADMIN"

interface HeaderUserProps {
  username:           string
  aiTokensRemaining?: number
  aiTokensMax?:       number
  plan?:              Plan
}

export function HeaderUser({ username, aiTokensRemaining, aiTokensMax, plan }: HeaderUserProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Estado local del contador (inicializado desde props del server) que
  // se actualiza en vivo cuando AIExplainPanel emite el evento.
  const [liveRemaining, setLiveRemaining] = useState(aiTokensRemaining)
  const [liveMax,       setLiveMax]       = useState(aiTokensMax)

  // Sincronizar si las props del server cambian (cambio de página / refresh)
  useEffect(() => { setLiveRemaining(aiTokensRemaining) }, [aiTokensRemaining])
  useEffect(() => { setLiveMax(aiTokensMax) }, [aiTokensMax])

  // Escuchar el evento del panel IA para actualizar al instante
  useEffect(() => {
    function onChange(e: Event) {
      const { detail } = e as CustomEvent<MonthlyQuota>
      if (typeof detail?.remaining === "number") setLiveRemaining(detail.remaining)
      if (typeof detail?.max === "number")       setLiveMax(detail.max)
    }
    window.addEventListener(AI_QUOTA_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(AI_QUOTA_CHANGED_EVENT, onChange)
  }, [])

  function handleLogout() {
    startTransition(async () => {
      await fetch("/api/auth/logout", { method: "POST" })
      router.push("/login")
      router.refresh()
    })
  }

  const initial = (username[0] ?? "?").toUpperCase()
  const hasQuota = typeof liveRemaining === "number" && typeof liveMax === "number"
  const lowQuota = hasQuota && liveRemaining! <= 5

  return (
    <div className="avatar">
      <Link
        href="/settings"
        title="Configuración"
        style={{ display: "inline-flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit" }}
      >
        <span className="pic" aria-hidden="true">{initial}</span>
        <span className="name">{username}</span>
        {plan && <PlanBadge plan={plan} />}
        {hasQuota && (
          <span
            title={`Te quedan ${liveRemaining} de ${liveMax} tokens IA este mes`}
            className="font-mono-tabular"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 8px",
              borderRadius: 999,
              background: lowQuota
                ? "rgba(239, 68, 68, 0.12)"
                : "rgba(168, 85, 247, 0.12)",
              color: lowQuota ? "var(--red-600)" : "rgb(126, 34, 206)",
              fontSize: 11,
              fontWeight: 800,
              border: lowQuota
                ? "1px solid rgba(239, 68, 68, 0.30)"
                : "1px solid rgba(168, 85, 247, 0.25)",
              transition: "background 0.2s, color 0.2s",
            }}
          >
            <Sparkles className="h-3 w-3" />
            {liveRemaining}/{liveMax}
          </span>
        )}
        <Settings className="h-3.5 w-3.5" style={{ color: "var(--slate-400)" }} />
      </Link>
      <button
        type="button"
        className="logout"
        onClick={handleLogout}
        disabled={isPending}
        title="Cerrar sesión"
        aria-label="Cerrar sesión"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  )
}

function PlanBadge({ plan }: { plan: Plan }) {
  const style: Record<Plan, { bg: string; color: string; border: string; icon: React.ReactNode; label: string; tip: string }> = {
    ADMIN: {
      bg: "linear-gradient(135deg, #facc15, #ea580c)",
      color: "#fff",
      border: "0",
      icon: <Shield className="h-3 w-3" />,
      label: "ADMIN",
      tip: "Acceso total · sin facturación",
    },
    PRO: {
      bg: "linear-gradient(135deg, rgb(168, 85, 247), rgb(236, 72, 153))",
      color: "#fff",
      border: "0",
      icon: <Crown className="h-3 w-3" />,
      label: "PRO",
      tip: "Suscripción PRO activa",
    },
    FREE: {
      bg: "var(--slate-100)",
      color: "var(--slate-500)",
      border: "1px solid var(--slate-200)",
      icon: null,
      label: "FREE",
      tip: "Plan gratuito — pulsa para mejorar",
    },
  }
  const s = style[plan]
  return (
    <span
      title={s.tip}
      className="font-mono-tabular"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 7px",
        borderRadius: 999,
        background: s.bg,
        color: s.color,
        border: s.border,
        fontSize: 10,
        fontWeight: 900,
        letterSpacing: "0.04em",
        boxShadow: plan === "PRO" || plan === "ADMIN" ? "0 4px 10px -4px rgba(0,0,0,0.25)" : "none",
      }}
    >
      {s.icon}
      {s.label}
    </span>
  )
}
