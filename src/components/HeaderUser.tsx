"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { LogOut } from "lucide-react"

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
      <span className="pic" aria-hidden="true">{initial}</span>
      <span className="name">{username}</span>
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
