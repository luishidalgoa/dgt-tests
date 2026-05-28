"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { Plus, X, Check, AlertCircle, Loader2, Tag as TagIcon } from "lucide-react"

/**
 * Botón "+" en la card del banco + modal para asignar un tag manual.
 *
 * Flow:
 *   1. Admin clica el botón `+` (siempre visible, junto a la lupa).
 *   2. Modal abre con:
 *      - Input que filtra los labels disponibles (LABEL_METADATA + discovered).
 *      - Lista de matches debajo del input — click selecciona el label.
 *      - Tags YA asignados a esta imagen (para que el admin no duplique).
 *      - Textarea opcional para el "por qué" — el LLM lo usará como
 *        few-shot example en el próximo run del classifier.
 *      - Botón "Añadir tag".
 *   3. POST /api/admin/images-bank/manual-tag.
 *   4. router.refresh() y modal se queda abierto para añadir más tags
 *      sobre la misma imagen sin tener que reabrirlo cada vez.
 *
 * Igual que FindReplacementsButton: portal al body para evitar
 * stacking issues + stopPropagation en gesture events del botón para
 * que el swipe del tile no se dispare.
 */

export interface AvailableLabel {
  id:         string
  displayEs:  string
  category?:  string
  /** Sugerencias descubiertas en runtime (discovered_labels.json) llevan
   *  flag para que el UI las marque como tales. */
  discovered?: boolean
}

interface Props {
  sha:              string
  /** Tags YA asignados (manual o classifier) — informativo en el modal. */
  existingTagIds:   readonly string[]
  /** Catálogo completo de labels disponibles para autocomplete. */
  availableLabels:  readonly AvailableLabel[]
}

export function AddManualTagButton({ sha, existingTagIds, availableLabels }: Props) {
  const [open,    setOpen]    = useState(false)
  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true) }, [])

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          setOpen(true)
        }}
        // SwipeableImageTile arranca con onMouseDown/onTouchStart; sin
        // stopPropagation, pulsar este botón empieza un swipe accidental.
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        title="Añadir tag manual (admin)"
        aria-label="Añadir tag manual"
        style={{
          display:        "inline-flex",
          alignItems:     "center",
          justifyContent: "center",
          width:          "100%",
          padding:        "4px 8px",
          gap:            5,
          border:         "1px dashed var(--slate-300)",
          background:     "transparent",
          color:          "var(--slate-500)",
          borderRadius:   6,
          cursor:         "pointer",
          fontSize:       10.5,
          fontWeight:     600,
          touchAction:    "none",
          transition:     "background 0.12s, color 0.12s, border-color 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background   = "rgba(99, 102, 241, 0.06)"
          e.currentTarget.style.color        = "var(--indigo-600, #6366f1)"
          e.currentTarget.style.borderColor  = "var(--indigo-300, #a5b4fc)"
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background  = "transparent"
          e.currentTarget.style.color       = "var(--slate-500)"
          e.currentTarget.style.borderColor = "var(--slate-300)"
        }}
      >
        <Plus size={11} />
        Añadir tag
      </button>
      {open && mounted && createPortal(
        <AddManualTagModal
          sha={sha}
          existingTagIds={existingTagIds}
          availableLabels={availableLabels}
          onClose={() => setOpen(false)}
        />,
        document.body,
      )}
    </>
  )
}

function AddManualTagModal({
  sha,
  existingTagIds,
  availableLabels,
  onClose,
}: Props & { onClose: () => void }) {
  const router       = useRouter()
  const [query,      setQuery]      = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reason,     setReason]     = useState("")
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [success,    setSuccess]    = useState<string | null>(null)
  // Set local con los tags ya añadidos en esta apertura para feedback inmediato
  // (la página se refresca al cerrar — esto es solo UI optimista).
  const [justAddedSet, setJustAddedSet] = useState<Set<string>>(new Set())

  const queryInputRef = useRef<HTMLInputElement>(null)

  // Autofocus al abrir
  useEffect(() => { queryInputRef.current?.focus() }, [])

  // Bloquear scroll del body
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = prev }
  }, [])

  // ── Filtrar matches ─────────────────────────────────────────────
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const alreadyTagged = new Set([...existingTagIds, ...justAddedSet])
    const base = q
      ? availableLabels.filter((l) => {
          const haystack = `${l.id} ${l.displayEs} ${l.category ?? ""}`.toLowerCase()
          return haystack.includes(q)
        })
      : availableLabels
    // Orden: primero los que NO están asignados, después los ya asignados
    // (atenuados). Dentro de cada grupo, alfabético por displayEs.
    const unassigned: AvailableLabel[] = []
    const assigned:   AvailableLabel[] = []
    for (const l of base) {
      if (alreadyTagged.has(l.id)) assigned.push(l)
      else unassigned.push(l)
    }
    const sortFn = (a: AvailableLabel, b: AvailableLabel) =>
      a.displayEs.localeCompare(b.displayEs, "es")
    return [...unassigned.sort(sortFn), ...assigned.sort(sortFn)].slice(0, 40)
  }, [availableLabels, query, existingTagIds, justAddedSet])

  // El admin puede SIEMPRE asignar (la spec acepta IDs custom no en la lista).
  // Si el query no machea ningún label conocido, le ofrecemos crear uno
  // nuevo si pasa el regex de TAG_ID válido.
  const queryTrimmed     = query.trim()
  const queryIsValidId   = /^[a-z][a-z0-9_-]{1,40}$/.test(queryTrimmed)
  const queryMatchesAny  = matches.some((m) => m.id === queryTrimmed)
  const canCreateNew     = queryIsValidId && !queryMatchesAny

  const effectiveTag = selectedId
    ?? (canCreateNew ? queryTrimmed : null)

  // ── Submit ──────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!effectiveTag || saving) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch("/api/admin/images-bank/manual-tag", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          sha,
          tag:    effectiveTag,
          reason: reason.trim() || undefined,
        }),
      })
      const data = (await res.json()) as {
        ok:           boolean
        error?:       string
        dedup?:       boolean
        updated?:     boolean
        totalForSha?: number
        tagsForSha?:  string[]
      }
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`)
        setSaving(false)
        return
      }
      setJustAddedSet((prev) => new Set([...prev, effectiveTag]))
      const noun = data.dedup
        ? data.updated ? "Justificación actualizada" : "Ya estaba asignado"
        : "Tag añadido"
      setSuccess(`${noun}: ${effectiveTag}`)
      // NO refrescamos el server data aquí — si lo hiciéramos, el grid
      // del fondo se repinta y la card que estamos editando puede
      // desaparecer (caso: filtro "Sin tag" + acabas de añadir uno →
      // la card sale del filtro → React desmonta el tile → el modal se
      // cierra con él). En vez de eso, el admin ve los tags añadidos
      // EN ESTE modal vía el chip "X añadidos ahora" del header. El
      // refresh se hace al cerrar (handleClose), cuando ya no importa
      // si la card cambia de bucket de filtro.
      // Reset solo el input + reason; mantenemos abierto y enfocado para
      // que el admin pueda seguir añadiendo más tags rápidamente.
      setQuery("")
      setSelectedId(null)
      setReason("")
      queryInputRef.current?.focus()
      setSaving(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  function handleClose() {
    if (justAddedSet.size > 0) router.refresh()
    onClose()
  }

  // ESC cierra, Enter submitea
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        handleClose()
        return
      }
      if (e.key === "Enter" && effectiveTag && !saving) {
        // Solo si NO estamos en el textarea de reason (ahí Enter es nueva línea)
        const tag = (e.target as HTMLElement)?.tagName
        if (tag !== "TEXTAREA") {
          e.preventDefault()
          handleSubmit()
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTag, saving, justAddedSet.size])

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
      role="dialog"
      aria-modal="true"
      aria-label="Añadir tag manual"
      style={{
        position:       "fixed",
        inset:          0,
        background:     "rgba(15, 23, 42, 0.55)",
        backdropFilter: "blur(3px)",
        zIndex:         600,
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        padding:        24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background:    "#fff",
          borderRadius:  14,
          maxWidth:      560,
          width:         "100%",
          maxHeight:     "85vh",
          boxShadow:     "0 30px 80px rgba(0,0,0,0.4)",
          display:       "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <header style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          padding:        "14px 22px",
          borderBottom:   "1px solid var(--slate-200)",
          background:     "var(--slate-50, #f8fafc)",
          gap:            12,
        }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
              <TagIcon size={16} />
              Añadir tag manual
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--slate-500)" }}>
              SHA: <code>{sha.slice(0, 12)}…</code>
              {existingTagIds.length > 0 && (
                <> · {existingTagIds.length} tag{existingTagIds.length === 1 ? "" : "s"} ya asignado{existingTagIds.length === 1 ? "" : "s"}</>
              )}
              {justAddedSet.size > 0 && (
                <> · <strong>{justAddedSet.size} añadido{justAddedSet.size === 1 ? "" : "s"} ahora</strong></>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Cerrar"
            style={{
              border: 0, background: "transparent", padding: 8,
              cursor: "pointer", color: "var(--slate-600)",
              borderRadius: 8, display: "inline-flex",
            }}
          >
            <X size={18} />
          </button>
        </header>

        {/* Body */}
        <div style={{ padding: 18, overflow: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Input + lista de matches */}
          <div>
            <label htmlFor="manual-tag-search" style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--slate-700)", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Label
            </label>
            <input
              id="manual-tag-search"
              ref={queryInputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSelectedId(null)   // resetear selección al teclear
              }}
              placeholder="Busca por displayEs / id / categoría — o crea uno nuevo escribiendo el id"
              autoComplete="off"
              spellCheck={false}
              style={{
                width:        "100%",
                padding:      "9px 12px",
                fontSize:     13.5,
                border:       "1px solid var(--slate-300)",
                borderRadius: 8,
                outline:      "none",
                fontFamily:   "inherit",
              }}
            />
            {/* Resultados */}
            <div style={{
              marginTop:    6,
              maxHeight:    220,
              overflowY:    "auto",
              border:       "1px solid var(--slate-100)",
              borderRadius: 8,
              background:   "var(--slate-50, #f8fafc)",
            }}>
              {matches.length === 0 && !canCreateNew && (
                <p style={{ padding: "14px 12px", margin: 0, fontSize: 12, color: "var(--slate-500)", textAlign: "center" }}>
                  Sin matches.
                </p>
              )}
              {canCreateNew && (
                <button
                  type="button"
                  onClick={() => setSelectedId(queryTrimmed)}
                  style={{
                    display:      "flex",
                    width:        "100%",
                    padding:      "8px 12px",
                    border:       0,
                    background:   selectedId === queryTrimmed
                                    ? "rgba(99, 102, 241, 0.12)"
                                    : "transparent",
                    textAlign:    "left",
                    cursor:       "pointer",
                    fontSize:     13,
                    color:        "var(--indigo-700, #4338ca)",
                    fontWeight:   600,
                    borderBottom: "1px solid var(--slate-100)",
                    gap:          8,
                    alignItems:   "center",
                  }}
                >
                  <Plus size={12} />
                  Crear label nuevo · <code>{queryTrimmed}</code>
                </button>
              )}
              {matches.map((m) => {
                const alreadyAssigned = existingTagIds.includes(m.id) || justAddedSet.has(m.id)
                const isSelected      = selectedId === m.id
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => { if (!alreadyAssigned) setSelectedId(m.id) }}
                    disabled={alreadyAssigned}
                    style={{
                      display:       "flex",
                      width:         "100%",
                      padding:       "7px 12px",
                      border:        0,
                      background:    isSelected
                                       ? "rgba(99, 102, 241, 0.12)"
                                       : "transparent",
                      textAlign:     "left",
                      cursor:        alreadyAssigned ? "default" : "pointer",
                      fontSize:      12.5,
                      color:         alreadyAssigned
                                       ? "var(--slate-400)"
                                       : isSelected
                                         ? "var(--indigo-700, #4338ca)"
                                         : "var(--slate-700)",
                      opacity:       alreadyAssigned ? 0.7 : 1,
                      borderBottom:  "1px solid rgba(0,0,0,0.04)",
                      alignItems:    "center",
                      gap:           8,
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <strong>{m.displayEs}</strong>
                      {" "}
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--slate-400)" }}>
                        {m.id}
                      </span>
                    </span>
                    {m.category && (
                      <span style={{
                        fontSize:     9.5,
                        color:        "var(--slate-500)",
                        background:   "var(--slate-100)",
                        padding:      "1px 6px",
                        borderRadius: 999,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        flexShrink:   0,
                      }}>
                        {m.category}
                      </span>
                    )}
                    {m.discovered && (
                      <span style={{ fontSize: 9, color: "var(--amber-d, #b45309)", fontWeight: 700, flexShrink: 0 }}>
                        nuevo
                      </span>
                    )}
                    {alreadyAssigned && (
                      <Check size={11} style={{ color: "var(--green, #16a34a)", flexShrink: 0 }} />
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Reason — opcional */}
          <div>
            <label htmlFor="manual-tag-reason" style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--slate-700)", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Por qué <span style={{ fontWeight: 500, color: "var(--slate-500)", textTransform: "none", letterSpacing: 0 }}>(opcional)</span>
            </label>
            <textarea
              id="manual-tag-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="Opcional — explica qué ves en la imagen para que el modelo aprenda. Ej: 'se ve un camión con remolque al fondo a la derecha'."
              rows={3}
              style={{
                width:        "100%",
                padding:      "9px 12px",
                fontSize:     12.5,
                border:       "1px solid var(--slate-300)",
                borderRadius: 8,
                outline:      "none",
                fontFamily:   "inherit",
                resize:       "vertical",
                minHeight:    60,
              }}
            />
            <div style={{ fontSize: 10, color: "var(--slate-400)", marginTop: 3, textAlign: "right" }}>
              {reason.length}/500
            </div>
          </div>

          {/* Error / success */}
          {error && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              padding: 10, borderRadius: 8,
              background: "rgba(239, 68, 68, 0.08)",
              color: "var(--red-700, #b91c1c)",
              fontSize: 12.5,
            }}>
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              {error}
            </div>
          )}
          {success && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: 10, borderRadius: 8,
              background: "rgba(34, 197, 94, 0.10)",
              color: "var(--green-700, #15803d)",
              fontSize: 12.5,
            }}>
              <Check size={14} />
              {success}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer style={{
          padding:        "12px 22px",
          borderTop:      "1px solid var(--slate-200)",
          background:     "var(--slate-50, #f8fafc)",
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          gap:            10,
        }}>
          <span style={{ fontSize: 11, color: "var(--slate-500)" }}>
            {effectiveTag
              ? <>Listo: <code>{effectiveTag}</code></>
              : <>Selecciona un label de la lista o escribe un id nuevo.</>}
          </span>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!effectiveTag || saving}
            style={{
              padding:        "8px 16px",
              border:         0,
              background:     !effectiveTag || saving
                                ? "var(--slate-300)"
                                : "var(--indigo-600, #6366f1)",
              color:          "#fff",
              borderRadius:   8,
              fontSize:       12.5,
              fontWeight:     700,
              cursor:         !effectiveTag || saving ? "default" : "pointer",
              display:        "inline-flex",
              alignItems:     "center",
              gap:            6,
            }}
          >
            {saving ? <Loader2 size={12} className="spin" /> : <Plus size={12} />}
            Añadir
          </button>
        </footer>

        <style jsx global>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          .spin { animation: spin 0.8s linear infinite; }
        `}</style>
      </div>
    </div>
  )
}
