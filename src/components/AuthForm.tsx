"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Eye, Lock, User } from "lucide-react"

interface AuthFormProps {
  mode: "login" | "register"
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get("redirect") ?? "/"

  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPwd, setShowPwd]   = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const isLogin = mode === "login"

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    startTransition(async () => {
      try {
        const payload = isLogin
          ? { username, password, remember }
          : { username, password }
        const res = await fetch(`/api/auth/${mode}`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(payload),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? "Error en la operación")
        }
        router.push(redirectTo)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido")
      }
    })
  }

  return (
    <div className="auth-page">
      <section className="auth-card" role="dialog" aria-labelledby="auth-title">
        <div className="auth-emoji" aria-hidden="true">🚗</div>
        <h1 id="auth-title" className="auth-title">
          {isLogin ? "¡Hola, conductor!" : "Bienvenido a bordo"}
        </h1>
        <p className="auth-sub">
          {isLogin
            ? "Prepárate para aprobar a la primera"
            : "Crea tu cuenta y empieza a practicar"}
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="username" className="auth-label">Usuario</label>
          <div className="auth-field">
            <span className="ico" aria-hidden="true"><User size={20} /></span>
            <input
              id="username"
              type="text"
              autoComplete="username"
              required
              minLength={3}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="tu_usuario"
            />
          </div>

          <label htmlFor="password" className="auth-label">Contraseña</label>
          <div className="auth-field">
            <span className="ico" aria-hidden="true"><Lock size={20} /></span>
            <input
              id="password"
              type={showPwd ? "text" : "password"}
              autoComplete={isLogin ? "current-password" : "new-password"}
              required
              minLength={isLogin ? 1 : 6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isLogin ? "••••••••••" : "Mínimo 6 caracteres"}
            />
            <button
              type="button"
              className="eye"
              onClick={() => setShowPwd((v) => !v)}
              aria-label={showPwd ? "Ocultar contraseña" : "Mostrar contraseña"}
            >
              <Eye size={20} />
            </button>
          </div>

          {isLogin && (
            <div className="auth-row">
              <label className="auth-remember">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                <span className="auth-check" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="3"
                    strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                Recordarme en este dispositivo
              </label>
            </div>
          )}

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="auth-cta" disabled={isPending}>
            <span aria-hidden="true">🚦</span>
            {isPending ? "Procesando..." : isLogin ? "Arrancar" : "Crear cuenta"}
          </button>

          <div className="auth-divider">
            {isLogin ? "o si eres nuevo" : "¿ya tienes cuenta?"}
          </div>

          <Link href={isLogin ? "/register" : "/login"} className="auth-signup">
            {isLogin ? "Crea tu cuenta gratis →" : "Inicia sesión →"}
          </Link>

          {isLogin && (
            <Link
              href="/"
              className="auth-guest"
              aria-label="Continuar sin cuenta"
            >
              <span aria-hidden="true">👤</span>
              Entrar como invitado
              <small>Sin guardar progreso</small>
            </Link>
          )}
        </form>
      </section>

      <div className="auth-footer-stripe">DGT TESTS · APRUEBA A LA PRIMERA</div>
    </div>
  )
}
