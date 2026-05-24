"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { Filter, RotateCcw, Search } from "lucide-react"

interface Props {
  initial: {
    padre:     string
    bloque:    string
    sub:       string
    id:        string
    q:         string
    tier:      string
    categoria: string
  }
  categories: { slug: string; name: string }[]
}

/**
 * Bloque de filtros del listado /admin/questions.
 *
 * Estado local controlado; al pulsar "Aplicar" construye el querystring
 * y navega. "Limpiar" vuelve a /admin/questions sin parámetros.
 *
 * Reseteamos `page` cuando cambian los filtros — si no, podrías quedar
 * en page 5 con un filtro que tiene 2 páginas y ver "vacío" sin razón.
 */
export function QuestionsFilters({ initial, categories }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [state, setState] = useState(initial)

  function update<K extends keyof typeof state>(k: K, v: string) {
    setState((s) => ({ ...s, [k]: v }))
  }

  function apply() {
    const qs = new URLSearchParams()
    if (state.padre.trim())     qs.set("padre",     state.padre.trim())
    if (state.bloque.trim())    qs.set("bloque",    state.bloque.trim())
    if (state.sub.trim())       qs.set("sub",       state.sub.trim())
    if (state.id.trim())        qs.set("id",        state.id.trim())
    if (state.q.trim())         qs.set("q",         state.q.trim())
    if (state.tier)             qs.set("tier",      state.tier)
    if (state.categoria)        qs.set("categoria", state.categoria)
    const s = qs.toString()
    startTransition(() => {
      router.push(s ? `/admin/questions?${s}` : "/admin/questions")
    })
  }

  function reset() {
    setState({ padre: "", bloque: "", sub: "", id: "", q: "", tier: "", categoria: "" })
    startTransition(() => router.push("/admin/questions"))
  }

  return (
    <div className="card-soft" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
        <Filter className="h-4 w-4" style={{ color: "var(--slate-500)" }} />
        <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--slate-500)" }}>
          Filtros
        </span>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: 10,
      }}>
        <Field label="Tema padre">
          <input
            type="text"
            value={state.padre}
            onChange={(e) => update("padre", e.target.value)}
            placeholder="1, 7, Def…"
            style={inputStyle}
            onKeyDown={(e) => { if (e.key === "Enter") apply() }}
          />
        </Field>
        <Field label="Bloque">
          <input
            type="text"
            value={state.bloque}
            onChange={(e) => update("bloque", e.target.value)}
            placeholder="1.2, 7.3…"
            style={inputStyle}
            onKeyDown={(e) => { if (e.key === "Enter") apply() }}
          />
        </Field>
        <Field label="Sub-bloque">
          <input
            type="text"
            value={state.sub}
            onChange={(e) => update("sub", e.target.value)}
            placeholder="1.2.5.3"
            style={inputStyle}
            onKeyDown={(e) => { if (e.key === "Enter") apply() }}
          />
        </Field>
        <Field label="ID exacto">
          <input
            type="number"
            min={1}
            value={state.id}
            onChange={(e) => update("id", e.target.value)}
            placeholder="12345"
            style={inputStyle}
            onKeyDown={(e) => { if (e.key === "Enter") apply() }}
          />
        </Field>
        <Field label="Buscar en enunciado">
          <input
            type="text"
            value={state.q}
            onChange={(e) => update("q", e.target.value)}
            placeholder="puede el conductor…"
            style={inputStyle}
            onKeyDown={(e) => { if (e.key === "Enter") apply() }}
          />
        </Field>
        <Field label="Tier">
          <select
            value={state.tier}
            onChange={(e) => update("tier", e.target.value)}
            style={inputStyle}
          >
            <option value="">Todos</option>
            <option value="FREE">FREE</option>
            <option value="PRO">PRO</option>
          </select>
        </Field>
        <Field label="Categoría">
          <select
            value={state.categoria}
            onChange={(e) => update("categoria", e.target.value)}
            style={inputStyle}
          >
            <option value="">Todas</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
        </Field>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button onClick={apply} disabled={isPending} style={btnPrimary}>
          <Search className="h-3.5 w-3.5" />
          Aplicar
        </button>
        <button onClick={reset} disabled={isPending} style={btnSecondary}>
          <RotateCcw className="h-3.5 w-3.5" />
          Limpiar
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        display: "block",
        fontSize: 10.5,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: "var(--slate-500)",
        marginBottom: 4,
      }}>
        {label}
      </label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width:        "100%",
  padding:      "6px 10px",
  borderRadius: 6,
  border:       "1.5px solid var(--slate-200)",
  fontSize:     12.5,
  fontFamily:   "inherit",
  outline:      "none",
  background:   "#fff",
}

const btnPrimary: React.CSSProperties = {
  display:      "inline-flex",
  alignItems:   "center",
  gap:          6,
  padding:      "8px 14px",
  borderRadius: 8,
  border:       0,
  background:   "var(--orange-600)",
  color:        "white",
  fontWeight:   700,
  fontSize:     13,
  cursor:       "pointer",
}

const btnSecondary: React.CSSProperties = {
  display:      "inline-flex",
  alignItems:   "center",
  gap:          6,
  padding:      "8px 14px",
  borderRadius: 8,
  border:       "1.5px solid var(--slate-200)",
  background:   "#fff",
  color:        "var(--slate-700)",
  fontWeight:   600,
  fontSize:     13,
  cursor:       "pointer",
}
