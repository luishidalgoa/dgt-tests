"use client"

import { useMemo } from "react"

interface Props {
  text:        string
  highlights:  string[]
}

/**
 * Renderiza `text` envolviendo en <mark className="hl-marker"> los substrings
 * que aparecen en `highlights`. El matching es CASE-INSENSITIVE — la IA a
 * veces baja una "P" inicial a minúscula al copiar la frase del temario, y
 * exigir case-sensitive haría que el highlight desapareciera. Lo subrayado
 * preserva el casing original del `text`, no el del `highlight`.
 *
 * Cada highlight se anima como si lo subrayara un rotulador amarillo de
 * izquierda a derecha (medio-lento).
 *
 * Algoritmo: ordenamos los highlights por longitud descendente y vamos
 * partiendo el texto en segmentos, evitando solapamientos.
 */
export function ExplanationWithHighlights({ text, highlights }: Props) {
  const parts = useMemo(() => splitWithHighlights(text, highlights), [text, highlights])

  // Asignamos un retraso diferente a cada highlight para que se vayan
  // subrayando una tras otra (efecto "voy subrayando" en papel).
  let highlightIndex = 0

  return (
    <p className="hl-explanation">
      {parts.map((p, i) => {
        if (p.type === "text") {
          return <span key={i}>{p.value}</span>
        }
        const delay = highlightIndex * 0.45 // 450ms entre cada subrayado
        highlightIndex++
        return (
          <mark
            key={i}
            className="hl-marker"
            style={{ animationDelay: `${delay}s` }}
          >
            {p.value}
          </mark>
        )
      })}
    </p>
  )
}

export type Segment = { type: "text" | "mark"; value: string }

export function splitWithHighlights(text: string, highlights: string[]): Segment[] {
  if (!highlights.length) return [{ type: "text", value: text }]

  // Hacemos todas las búsquedas en lowercase para tolerar los desajustes de
  // mayúsculas que comete la IA al copiar frases del temario. Pero los
  // índices y `text.slice()` finales usan el texto original — así el
  // <mark> muestra el casing del temario, no el del modelo.
  const textLower = text.toLowerCase()

  // Filtrar highlights: deben existir en el texto (case-insensitive) y no estar vacíos
  const unique = Array.from(
    new Set(
      highlights
        .map((h) => h.trim())
        .filter((h) => h.length > 0 && textLower.includes(h.toLowerCase()))
    )
  ).sort((a, b) => b.length - a.length) // largos primero

  if (!unique.length) return [{ type: "text", value: text }]

  // Acumulamos rangos no solapados [start, end)
  const ranges: { start: number; end: number }[] = []

  for (const phrase of unique) {
    const phraseLower = phrase.toLowerCase()
    let from = 0
    while (from <= text.length - phrase.length) {
      const idx = textLower.indexOf(phraseLower, from)
      if (idx === -1) break
      const end = idx + phrase.length
      // ¿Solapa con un rango existente?
      const overlaps = ranges.some(
        (r) => idx < r.end && end > r.start
      )
      if (!overlaps) ranges.push({ start: idx, end })
      from = end
    }
  }

  if (!ranges.length) return [{ type: "text", value: text }]

  // Ordenar rangos por inicio
  ranges.sort((a, b) => a.start - b.start)

  const out: Segment[] = []
  let cursor = 0
  for (const r of ranges) {
    if (r.start > cursor) out.push({ type: "text", value: text.slice(cursor, r.start) })
    out.push({ type: "mark", value: text.slice(r.start, r.end) })
    cursor = r.end
  }
  if (cursor < text.length) out.push({ type: "text", value: text.slice(cursor) })
  return out
}
