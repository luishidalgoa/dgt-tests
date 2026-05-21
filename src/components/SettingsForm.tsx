"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Save, CheckCircle2 } from "lucide-react"

interface Props {
  initialUsername:    string
  initialDisplayName: string
}

export function SettingsForm({ initialUsername, initialDisplayName }: Props) {
  const router = useRouter()
  const [username,    setUsername]    = useState(initialUsername)
  const [displayName, setDisplayName] = useState(initialDisplayName)
  const [error, setError]     = useState<string | null>(null)
  const [saved, setSaved]     = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    startTransition(async () => {
      try {
        const res = await fetch("/api/users/me", {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ username, displayName }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? "Error al guardar")
        }
        setSaved(true)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido")
      }
    })
  }

  const isClean =
    username === initialUsername && displayName === initialDisplayName

  return (
    <form onSubmit={handleSubmit} className="card-soft" style={{ padding: 28, maxWidth: 520 }}>
      <div style={{ marginBottom: 18 }}>
        <label className="auth-label" htmlFor="username">Nombre de usuario</label>
        <input
          id="username"
          type="text"
          required
          minLength={3}
          maxLength={40}
          pattern="[a-zA-Z0-9_.\-]+"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={{
            width: "100%", height: 46, padding: "0 14px",
            borderRadius: 12, border: "1.5px solid var(--slate-200)",
            fontSize: 14.5, fontFamily: "inherit", outline: "none",
          }}
        />
        <p style={{ fontSize: 12, color: "var(--slate-500)", marginTop: 6, marginBottom: 0 }}>
          Este es el nombre con el que inicias sesión. Letras, números, _ . -
        </p>
      </div>

      <div style={{ marginBottom: 18 }}>
        <label className="auth-label" htmlFor="displayName">Nombre visible</label>
        <input
          id="displayName"
          type="text"
          required
          minLength={1}
          maxLength={80}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          style={{
            width: "100%", height: 46, padding: "0 14px",
            borderRadius: 12, border: "1.5px solid var(--slate-200)",
            fontSize: 14.5, fontFamily: "inherit", outline: "none",
          }}
        />
        <p style={{ fontSize: 12, color: "var(--slate-500)", marginTop: 6, marginBottom: 0 }}>
          Cómo apareces en el dashboard y las partys.
        </p>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 14 }}>{error}</div>}
      {saved && (
        <div
          style={{
            borderRadius: 12,
            background: "rgba(34, 197, 94, 0.10)",
            border: "1px solid rgba(34, 197, 94, 0.40)",
            color: "var(--green-d)",
            padding: "10px 14px",
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 14,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <CheckCircle2 className="h-4 w-4" />
          Guardado correctamente
        </div>
      )}

      <button
        type="submit"
        disabled={isPending || isClean}
        className="btn-primary"
        style={{ width: "100%" }}
      >
        {isPending ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Guardando...</>
        ) : (
          <><Save className="h-4 w-4" /> Guardar cambios</>
        )}
      </button>
    </form>
  )
}
