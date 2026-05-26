"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Swords } from "lucide-react"
import { apiFetch } from "@/lib/apiClient"

interface Cat { id: number; name: string; slug: string }

const QUESTION_OPTIONS = [10, 20, 30] as const

export function NewPartyForm({ categories }: { categories: Cat[] }) {
  const router = useRouter()
  const [categoryId, setCategoryId] = useState<number | null>(categories[0]?.id ?? null)
  const [numQuestions, setNumQuestions] = useState<number>(20)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        const res = await apiFetch("/api/parties", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ categoryId, totalQuestions: numQuestions }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? "Error creando la party")
        }
        const data = await res.json() as { code: string }
        router.push(`/party/${data.code}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido")
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="card-soft warm" style={{ padding: 28 }}>
      <div className="mb-6">
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10, color: "var(--slate-700)" }}>
          Categoría
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCategoryId(null)}
            className={categoryId === null ? "btn-primary" : "btn-secondary"}
          >
            Todas
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoryId(c.id)}
              className={categoryId === c.id ? "btn-primary" : "btn-secondary"}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-6">
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10, color: "var(--slate-700)" }}>
          Número de preguntas
        </div>
        <div className="flex flex-wrap gap-2">
          {QUESTION_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNumQuestions(n)}
              className={numQuestions === n ? "btn-primary" : "btn-secondary"}
            >
              {n} preguntas
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <button type="submit" disabled={isPending} className="btn-primary" style={{ width: "100%", padding: "14px 18px", fontSize: 15 }}>
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Creando...
          </>
        ) : (
          <>
            <Swords className="h-4 w-4" />
            Crear party
          </>
        )}
      </button>

      <p style={{ fontSize: 12, color: "var(--slate-500)", marginTop: 14, marginBottom: 0, textAlign: "center" }}>
        Al crear la party recibirás un código de invitación para compartir.
      </p>
    </form>
  )
}
