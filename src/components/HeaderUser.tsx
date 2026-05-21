"use client"

import { useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { LogOut, Settings } from "lucide-react"

interface HeaderUserProps {
  username: string
}

export function HeaderUser({ username }: HeaderUserProps) {
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

  return (
    <div className="avatar">
      <Link
        href="/settings"
        title="Configuración"
        style={{ display: "inline-flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit" }}
      >
        <span className="pic" aria-hidden="true">{initial}</span>
        <span className="name">{username}</span>
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
