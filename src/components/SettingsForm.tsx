"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Save, CheckCircle2, KeyRound, Eye } from "lucide-react"

interface Props {
  initialUsername:    string
  initialDisplayName: string
  initialEmail:       string
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 46,
  padding: "0 14px",
  borderRadius: 12,
  border: "1.5px solid var(--slate-200)",
  fontSize: 14.5,
  fontFamily: "inherit",
  outline: "none",
}

const helpStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--slate-500)",
  marginTop: 6,
  marginBottom: 0,
}

export function SettingsForm({ initialUsername, initialDisplayName, initialEmail }: Props) {
  const router = useRouter()

  // ── Estado perfil ─────────────────────────────────────────────────
  const [username,    setUsername]    = useState(initialUsername)
  const [displayName, setDisplayName] = useState(initialDisplayName)
  const [email,       setEmail]       = useState(initialEmail)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  // ── Estado password ────────────────────────────────────────────────
  const [pwdOpen, setPwdOpen]         = useState(false)
  const [currentPassword, setCurrent] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirm, setConfirm]         = useState("")
  const [showPwd, setShowPwd]         = useState(false)
  const [pwdError, setPwdError]       = useState<string | null>(null)
  const [pwdSaved, setPwdSaved]       = useState(false)
  const [pwdPending, startPwd]        = useTransition()

  function handleSubmitProfile(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    startTransition(async () => {
      try {
        const res = await fetch("/api/users/me", {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ username, displayName, email: email.trim() || null }),
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

  function handleSubmitPassword(e: React.FormEvent) {
    e.preventDefault()
    setPwdError(null)
    setPwdSaved(false)
    if (newPassword !== confirm) {
      setPwdError("Las contraseñas nuevas no coinciden")
      return
    }
    if (newPassword.length < 6) {
      setPwdError("La nueva contraseña debe tener al menos 6 caracteres")
      return
    }
    startPwd(async () => {
      try {
        const res = await fetch("/api/users/me/password", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ currentPassword, newPassword }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? "Error al cambiar la contraseña")
        }
        setPwdSaved(true)
        setCurrent("")
        setNewPassword("")
        setConfirm("")
        // Auto-colapsar tras 2s
        setTimeout(() => setPwdOpen(false), 1500)
      } catch (err) {
        setPwdError(err instanceof Error ? err.message : "Error desconocido")
      }
    })
  }

  const isClean =
    username === initialUsername &&
    displayName === initialDisplayName &&
    (email || "") === (initialEmail || "")

  return (
    <>
      {/* ─── Form de perfil ─────────────────────────────────────────── */}
      <form onSubmit={handleSubmitProfile} className="card-soft" style={{ padding: 28, maxWidth: 520 }}>
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
            style={inputStyle}
          />
          <p style={helpStyle}>
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
            style={inputStyle}
          />
          <p style={helpStyle}>
            Cómo apareces en el dashboard y en las partys.
          </p>
        </div>

        <div style={{ marginBottom: 18 }}>
          <label className="auth-label" htmlFor="email">
            Email{" "}
            <span style={{ fontWeight: 400, color: "var(--slate-400)" }}>(opcional)</span>
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="tucorreo@ejemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
          <p style={helpStyle}>
            Lo usaremos en el futuro para recuperación de contraseña y avisos
            importantes. Nunca se comparte.
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

      {/* ─── Cambiar contraseña ────────────────────────────────────── */}
      <div className="card-soft" style={{ padding: 0, maxWidth: 520, marginTop: 22, overflow: "hidden" }}>
        <button
          type="button"
          onClick={() => { setPwdOpen((v) => !v); setPwdError(null); setPwdSaved(false) }}
          className="w-full text-left flex items-center gap-3"
          style={{
            padding: "18px 22px",
            background: "transparent",
            border: 0,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <div
            className="flex items-center justify-center rounded-xl"
            style={{
              width: 42,
              height: 42,
              background: "var(--slate-100)",
              color: "var(--slate-600)",
            }}
          >
            <KeyRound className="h-5 w-5" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Cambiar contraseña</div>
            <div style={{ fontSize: 12.5, color: "var(--slate-500)" }}>
              {pwdOpen ? "Rellena los campos de abajo" : "Pulsa para abrir el formulario"}
            </div>
          </div>
          <span
            style={{
              transform: pwdOpen ? "rotate(180deg)" : "rotate(0)",
              transition: "transform 0.15s",
              fontSize: 13,
              color: "var(--slate-400)",
            }}
            aria-hidden="true"
          >
            ▼
          </span>
        </button>

        {pwdOpen && (
          <form onSubmit={handleSubmitPassword} style={{ padding: "0 22px 22px" }}>
            <div style={{ marginBottom: 14 }}>
              <label className="auth-label" htmlFor="currentPassword">Contraseña actual</label>
              <div style={{ position: "relative" }}>
                <input
                  id="currentPassword"
                  type={showPwd ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrent(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label className="auth-label" htmlFor="newPassword">Nueva contraseña</label>
              <input
                id="newPassword"
                type={showPwd ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                style={inputStyle}
              />
              <p style={helpStyle}>Mínimo 6 caracteres.</p>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label className="auth-label" htmlFor="confirm">Repite la nueva contraseña</label>
              <input
                id="confirm"
                type={showPwd ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                style={inputStyle}
              />
            </div>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 14,
                fontSize: 12.5,
                color: "var(--slate-600)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={showPwd}
                onChange={(e) => setShowPwd(e.target.checked)}
              />
              <Eye className="h-3.5 w-3.5" />
              Mostrar contraseñas
            </label>

            {pwdError && <div className="auth-error" style={{ marginBottom: 14 }}>{pwdError}</div>}
            {pwdSaved && (
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
                Contraseña actualizada
              </div>
            )}

            <button
              type="submit"
              disabled={pwdPending}
              className="btn-primary"
              style={{ width: "100%" }}
            >
              {pwdPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Cambiando...</>
              ) : (
                <><KeyRound className="h-4 w-4" /> Cambiar contraseña</>
              )}
            </button>
          </form>
        )}
      </div>
    </>
  )
}
