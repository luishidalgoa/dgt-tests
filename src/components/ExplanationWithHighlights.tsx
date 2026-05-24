"use client"

import { useMemo } from "react"

interface Props {
  text:        string
  highlights:  string[]
}

/**
 * Renderiza `text` envolviendo en <mark className="hl-marker"> los substrings
 * que aparecen en `highlights`. El matching es CASE-INSENSITIVE y también
 * insensible a TILDES — la IA a veces baja una "P" inicial a minúscula o
 * pierde una tilde al copiar la frase del temario, y exigir match exacto
 * haría que el highlight desapareciera. Lo subrayado preserva el casing y
 * las tildes originales del `text`, no las del `highlight`.
 *
 * Trade-off de quitar tildes: "está" y "esta" se vuelven equivalentes para
 * la búsqueda. En la práctica del temario DGT no genera problemas
 * (la frase contigua sigue mostrándose con su tilde original).
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

/**
 * Normaliza una cadena para búsqueda tolerante: NFC → NFD → strip de
 * combining marks (U+0300–U+036F) → lowercase. Para texto español típico
 * en NFC, la longitud en codepoints se preserva (cada precompuesto con
 * tilde se reemplaza por su letra base, sin combinable separado).
 *
 * Regex construida con new RegExp + escapes \u para evitar problemas con
 * editores/renderizadores que se comen los combining marks invisibles
 * en literales /…/ — el comportamiento es el mismo que /[̀-ͯ]/g.
 */
const COMBINING_MARKS_RE = new RegExp("[\\u0300-\\u036f]", "g")

function normalizeForSearch(s: string): string {
  return s
    .normalize("NFC")
    .normalize("NFD")
    .replace(COMBINING_MARKS_RE, "")
    .toLowerCase()
}

export function splitWithHighlights(text: string, highlights: string[]): Segment[] {
  if (!highlights.length) return [{ type: "text", value: text }]

  // Hacemos todas las búsquedas en lowercase + sin tildes para tolerar los
  // desajustes que comete la IA al copiar frases del temario. Pero los
  // índices y `text.slice()` finales usan el texto original — así el
  // <mark> muestra el casing y las tildes del temario, no las del modelo.
  //
  // SAFEGUARD: la normalización solo es 1:1 (en codepoints) si el texto
  // original ya está en NFC y solo perdemos diacríticos combinables. Si la
  // longitud cambia tras normalizar, los índices no mapean al original y
  // caemos al matching simple (case-insensitive, sin quitar tildes).
  const textNormalized = normalizeForSearch(text)
  const safeForDiacritics = textNormalized.length === text.length
  const textKey = safeForDiacritics ? textNormalized : text.toLowerCase()
  const normalizePhrase = (s: string) =>
    safeForDiacritics ? normalizeForSearch(s) : s.toLowerCase()

  // Filtrar highlights: deben existir en el texto (normalizado) y no estar vacíos
  const unique = Array.from(
    new Set(
      highlights
        .map((h) => h.trim())
        .filter((h) => h.length > 0 && textKey.includes(normalizePhrase(h)))
    )
  ).sort((a, b) => b.length - a.length) // largos primero

  if (!unique.length) return [{ type: "text", value: text }]

  // Acumulamos rangos no solapados [start, end)
  const ranges: { start: number; end: number }[] = []

  for (const phrase of unique) {
    const phraseKey = normalizePhrase(phrase)
    let from = 0
    while (from <= text.length - phraseKey.length) {
      const idx = textKey.indexOf(phraseKey, from)
      if (idx === -1) break
      const end = idx + phraseKey.length
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
