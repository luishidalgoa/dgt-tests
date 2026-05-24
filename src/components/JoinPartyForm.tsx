"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, LogIn } from "lucide-react"

const CODE_LENGTH = 6
const CODE_REGEX  = /^[A-Z0-9]{6}$/

function sanitize(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH)
}

export function JoinPartyForm() {
  const router = useRouter()
  const [code,  setCode]  = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const clean = sanitize(code)
    if (!CODE_REGEX.test(clean)) {
      setError("El código debe tener 6 caracteres (letras y números)")
      return
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/parties/${clean}`, { method: "GET" })
        if (res.status === 404) {
          setError("No existe ninguna party con ese código")
          return
        }
        if (!res.ok) {
          setError("No se pudo verificar el código. Inténtalo de nuevo.")
          return
        }
        router.push(`/party/${clean}`)
      } catch {
        setError("Sin conexión. Comprueba tu red e inténtalo de nuevo.")
      }
    })
  }

  const trimmed = sanitize(code)
  const ready   = CODE_REGEX.test(trimmed) && !isPending

  return (
    <form onSubmit={handleSubmit} className="card-soft" style={{ padding: 20 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10, color: "var(--slate-700)" }}>
        ¿Te han pasado un código?
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <input
          type="text"
          value={code}
          onChange={(e) => { setCode(sanitize(e.target.value)); setError(null) }}
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={CODE_LENGTH}
          placeholder="AB12CD"
          aria-label="Código de party"
          className="font-mono-tabular"
          style={{
            height: 56,
            padding: "0 16px",
            borderRadius: 12,
            border: `1.5px solid ${error ? "var(--red-500, #ef4444)" : "var(--slate-200)"}`,
            fontSize: 24,
            letterSpacing: "0.35em",
            textAlign: "center",
            textTransform: "uppercase",
            outline: "none",
            background: "#fff",
          }}
        />
        <button
          type="submit"
          disabled={!ready}
          className="btn-primary"
          style={{ width: "100%", padding: "14px 18px", fontSize: 15 }}
        >
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Comprobando...
            </>
          ) : (
            <>
              <LogIn className="h-4 w-4" />
              Unirse a la party
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="auth-error" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      <p style={{ fontSize: 12, color: "var(--slate-500)", marginTop: 12, marginBottom: 0, textAlign: "center" }}>
        Introduce el código de 6 caracteres que te haya pasado el host.
      </p>
    </form>
  )
}
