"use client"

import { useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { LogOut, Settings, Sparkles } from "lucide-react"

interface HeaderUserProps {
  username:           string
  aiTokensRemaining?: number
  aiTokensMax?:       number
}

export function HeaderUser({ username, aiTokensRemaining, aiTokensMax }: HeaderUserProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleLogout() {
    startTransition(async () => {
      await fetch("/api/auth/logout", { method: "POST" })
      router.push("/login")
      router.refresh()
    })
  }

  const initial = (username[0] ?? "?").toUpperCase()
  const hasQuota = typeof aiTokensRemaining === "number" && typeof aiTokensMax === "number"
  const lowQuota = hasQuota && aiTokensRemaining! <= 5

  return (
    <div className="avatar">
      <Link
        href="/settings"
        title="Configuración"
        style={{ display: "inline-flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit" }}
      >
        <span className="pic" aria-hidden="true">{initial}</span>
        <span className="name">{username}</span>
        {hasQuota && (
          <span
            title={`Te quedan ${aiTokensRemaining} de ${aiTokensMax} tokens IA este mes`}
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
            }}
          >
            <Sparkles className="h-3 w-3" />
            {aiTokensRemaining}/{aiTokensMax}
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
