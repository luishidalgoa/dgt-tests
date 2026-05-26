"use client"

import { useState, useEffect, useCallback, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Swords,
  Copy,
  Check,
  Users,
  Play,
  Loader2,
  Trophy,
  ChevronLeft,
} from "lucide-react"
import type { PartyState } from "@/lib/party"
import { apiFetch } from "@/lib/apiClient"

interface Props {
  code:             string
  isAuthenticated:  boolean
  isMember:         boolean
  myDisplayName:    string | null
}

export function PartyLobby({ code, isAuthenticated, isMember: initialIsMember, myDisplayName }: Props) {
  const router = useRouter()
  const [state, setState]       = useState<PartyState | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [isMember, setIsMember] = useState(initialIsMember)
  const [guestName, setGuestName] = useState("")
  const [copied, setCopied]     = useState(false)
  const [isPending, startTransition] = useTransition()

  // Polling cada 2s del estado
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>

    async function tick() {
      try {
        const res = await apiFetch(`/api/parties/${code}`, {
          cache: "no-store",
          // 404 = party borrada / código inválido — flujo esperado durante
          // el polling (no es bug). Sin esto, cada poll fallido en partys
          // expiradas fire un Sentry warning cada 2s = ruido.
          ignoreStatus: [404],
        })
        if (!res.ok) {
          if (alive) setError("Party no encontrada")
          return
        }
        const data = await res.json() as PartyState
        if (alive) {
          setState(data)
          setError(null)
          if (data.status === "playing" && isMember) {
            // Si la party arrancó y soy miembro, redirige a play
            router.push(`/party/${code}/play`)
            return
          }
          if (data.status === "finished") {
            router.push(`/party/${code}/results`)
            return
          }
        }
      } catch {
        // ignore (transitorios)
      }
      if (alive) timer = setTimeout(tick, 2000)
    }

    tick()
    return () => { alive = false; clearTimeout(timer) }
  }, [code, isMember, router])

  const copyLink = useCallback(async () => {
    const url = `${window.location.origin}/party/${code}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [code])

  const joinAsUser = () => {
    startTransition(async () => {
      try {
        const res = await apiFetch(`/api/parties/${code}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body:    "{}",
          // 400 = party llena / ya empezada. El UI muestra el error al user.
          ignoreStatus: [400],
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? "Error uniéndose")
        }
        setIsMember(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error")
      }
    })
  }

  const joinAsGuest = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      try {
        const res = await apiFetch(`/api/parties/${code}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ guestName: guestName.trim() }),
          // Igual que el otro join: 400 = party llena/ya empezada. UX normal.
          ignoreStatus: [400],
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? "Error uniéndose")
        }
        setIsMember(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error")
      }
    })
  }

  const startGame = () => {
    startTransition(async () => {
      try {
        const res = await apiFetch(`/api/parties/${code}`, {
          method: "POST",
          // 400 = no eres host / menos de 2 jugadores. UX espera el error.
          ignoreStatus: [400],
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? "No se pudo iniciar")
        }
        router.push(`/party/${code}/play`)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error")
      }
    })
  }

  if (error && !state) {
    return (
      <div className="empty-state">
        <span className="ico">😕</span>
        {error}
        <div style={{ marginTop: 18 }}>
          <Link href="/" className="btn-primary" style={{ display: "inline-flex" }}>Inicio</Link>
        </div>
      </div>
    )
  }

  if (!state) {
    return (
      <div className="empty-state">
        <Loader2 className="h-6 w-6 animate-spin mx-auto" style={{ color: "var(--orange-600)" }} />
        <div style={{ marginTop: 12 }}>Cargando party...</div>
      </div>
    )
  }

  const youArePlayer = state.players.find((p) => p.isYou)
  const youAreHost   = youArePlayer?.isHost ?? false
  const isFull       = state.players.length >= 4

  return (
    <div>
      <Link href="/" className="back-link">
        <ChevronLeft className="h-4 w-4" />
        Inicio
      </Link>

      <header className="page-header">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Swords className="h-7 w-7" style={{ color: "var(--red-600)" }} />
            Sala de espera
          </h1>
          <p className="lead">
            {state.totalQuestions} preguntas
            {state.categoryName && ` · ${state.categoryName}`}
            {" · "}
            Host: <b>{state.hostName}</b>
          </p>
        </div>
      </header>

      {/* Código + invitación */}
      <div className="card-soft warm" style={{ padding: 24, marginBottom: 16 }}>
        <div style={{ fontSize: 11.5, color: "var(--slate-500)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Código de invitación
        </div>
        <div className="font-mono-tabular flex items-center gap-3 mt-2" style={{ fontSize: 36, fontWeight: 900, letterSpacing: "0.15em", color: "var(--orange-600)" }}>
          {code}
          <button
            type="button"
            onClick={copyLink}
            className="btn-secondary"
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            {copied ? (<><Check className="h-3.5 w-3.5" /> Copiado</>) : (<><Copy className="h-3.5 w-3.5" /> Copiar enlace</>)}
          </button>
        </div>
        <div style={{ fontSize: 13, color: "var(--slate-500)", fontWeight: 500, marginTop: 8 }}>
          Comparte este enlace para que se unan tus amigos (hasta 4 jugadores en total)
        </div>
      </div>

      {/* Joining */}
      {!isMember && (
        <div className="card-soft" style={{ padding: 24, marginBottom: 16 }}>
          {isFull ? (
            <div style={{ color: "var(--red-500)", fontWeight: 600 }}>
              La party está llena
            </div>
          ) : isAuthenticated ? (
            <button onClick={joinAsUser} disabled={isPending} className="btn-primary" style={{ width: "100%" }}>
              {isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Uniéndose...</> : <>Unirme como <b>&nbsp;{myDisplayName}</b></>}
            </button>
          ) : (
            <form onSubmit={joinAsGuest} className="space-y-3">
              <div>
                <label className="auth-label">Tu nombre (para esta party)</label>
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  required
                  minLength={1}
                  maxLength={20}
                  placeholder="Pepe"
                  className="w-full"
                  style={{
                    height: 48,
                    padding: "0 16px",
                    borderRadius: 12,
                    border: "1.5px solid var(--slate-200)",
                    fontSize: 15,
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                />
              </div>
              <button type="submit" disabled={isPending || !guestName.trim()} className="btn-primary" style={{ width: "100%" }}>
                {isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Uniéndose...</> : "Unirme como invitado"}
              </button>
              <p style={{ fontSize: 12, color: "var(--slate-500)", margin: 0 }}>
                ¿Tienes cuenta? <Link href="/login" style={{ color: "var(--orange-600)", fontWeight: 700 }}>Inicia sesión</Link> y se guardará tu progreso.
              </p>
            </form>
          )}
        </div>
      )}

      {/* Lista de jugadores */}
      <div className="dash-section-title" style={{ margin: "8px 4px 14px" }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Users className="h-5 w-5" />
          Jugadores ({state.players.length}/4)
        </h3>
      </div>
      <div className="card-soft" style={{ padding: 8, marginBottom: 16 }}>
        {state.players.map((p) => (
          <div key={p.id} className="dash-row-item">
            <div
              style={{
                width: 32, height: 32, borderRadius: "50%",
                background: p.isYou
                  ? "linear-gradient(135deg, var(--orange-500), var(--red-600))"
                  : "linear-gradient(135deg, #94a3b8, #475569)",
                color: "#fff", fontWeight: 800, fontSize: 14,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {p.name[0]?.toUpperCase()}
            </div>
            <div className="dash-row-title">
              {p.name}
              {p.isYou && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--orange-600)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>(tú)</span>}
              <small>
                {p.isHost ? "Host" : "Invitado"}
                {p.isGuest && " · guest"}
              </small>
            </div>
            <span style={{
              fontSize: 11.5,
              color: "var(--slate-500)",
              fontWeight: 600,
            }}>
              {p.isHost ? <Trophy className="h-4 w-4 inline" style={{ color: "var(--amber)" }} /> : ""}
            </span>
          </div>
        ))}
        {Array.from({ length: 4 - state.players.length }).map((_, i) => (
          <div key={`empty-${i}`} className="dash-row-item" style={{ opacity: 0.4 }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              border: "2px dashed var(--slate-300)",
              background: "transparent",
            }} />
            <div className="dash-row-title" style={{ color: "var(--slate-400)" }}>
              Esperando jugador...
            </div>
            <span />
          </div>
        ))}
      </div>

      {/* CTA: empezar (solo host) */}
      {youAreHost && (
        <button
          onClick={startGame}
          disabled={isPending || state.players.length < 2}
          className="btn-amber"
          style={{ width: "100%", padding: "16px 18px", fontSize: 15 }}
        >
          {isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Iniciando...</> : (
            <>
              <Play className="h-4 w-4 fill-current" />
              Empezar partida ({state.players.length} {state.players.length === 1 ? "jugador" : "jugadores"})
            </>
          )}
        </button>
      )}
      {youAreHost && state.players.length < 2 && (
        <p style={{ fontSize: 12, color: "var(--slate-500)", marginTop: 10, textAlign: "center" }}>
          Necesitas al menos 2 jugadores para empezar.
        </p>
      )}

      {error && (
        <div className="auth-error" style={{ marginTop: 16 }}>{error}</div>
      )}
    </div>
  )
}
