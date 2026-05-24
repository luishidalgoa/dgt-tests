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
 * Regex de combining marks (tildes Unicode descompuestas). Construida con
 * new RegExp + escapes \u para evitar que editores/renderers se coman los
 * caracteres invisibles del literal /…/.
 */
const COMBINING_MARKS_RE = new RegExp("[\\u0300-\\u036f]", "g")
const WHITESPACE_RE      = /\s/

/**
 * Índice de búsqueda con mapping posicional:
 *
 *   - `needle`: versión normalizada del texto, donde
 *       · cada run de whitespace (espacios, tabs, NBSP, newlines) → " " (1 espacio)
 *       · cada char no-whitespace → su forma NFD-sin-tildes en minúscula
 *
 *   - `map[i]`: posición en el texto ORIGINAL del primer codepoint que
 *       generó `needle[i]`. Para un run de whitespace, apunta al PRIMER
 *       espacio del run. Para un char normal, apunta al char en sí.
 *
 * Con este map podemos buscar en needle pero renderizar slices del texto
 * original — así el `<mark>` preserva las tildes, el casing y los dobles
 * espacios del temario, aunque el modelo IA los haya "limpiado" al copiar.
 */
interface SearchIndex { needle: string; map: number[] }

function buildSearchIndex(s: string): SearchIndex {
  const chars: string[] = []
  const map: number[]   = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (WHITESPACE_RE.test(ch)) {
      // Run de whitespace → colapsar a un único " " en el needle.
      const start = i
      while (i < s.length && WHITESPACE_RE.test(s[i])) i++
      chars.push(" ")
      map.push(start)
      continue
    }
    // Char normal: NFD + strip combining marks + lowercase.
    // En texto español típico (NFC), cada precompuesto se descompone a 1 base
    // + N combining marks, y tras strip queda 1 carácter base. Mantenemos 1:1
    // por char input, pero si la descomposición devuelve >1 char (rarísimo en
    // español), los añadimos todos mapeando al mismo origen.
    const normalized = ch
      .normalize("NFD")
      .replace(COMBINING_MARKS_RE, "")
      .toLowerCase()
    if (normalized.length === 0) {
      // Era un combining mark suelto (texto ya en NFD). Ignorar.
      i++
      continue
    }
    for (const c of normalized) {
      chars.push(c)
      map.push(i)
    }
    i++
  }
  return { needle: chars.join(""), map }
}

/** Solo el needle (sin map) — útil para el phrase a buscar. */
function buildSearchKey(s: string): string {
  return buildSearchIndex(s).needle
}

export function splitWithHighlights(text: string, highlights: string[]): Segment[] {
  if (!highlights.length) return [{ type: "text", value: text }]

  // Construimos índice del texto. El needle es la versión "ascii-lower-collapsed"
  // y el map permite traducir índices de needle → posiciones del texto original.
  const { needle: textKey, map: textMap } = buildSearchIndex(text)
  if (textKey.length === 0) return [{ type: "text", value: text }]

  // Normaliza + filtra highlights: trim, descarta vacíos, descarta los que
  // no aparecen en el textKey. Dedupe + ordena por longitud desc (largos
  // primero, para que "alfa beta" gane sobre "alfa" en caso de solape).
  const seen = new Set<string>()
  const phraseKeys: { key: string }[] = []
  for (const raw of highlights) {
    const key = buildSearchKey(raw.trim())
    if (!key.length || seen.has(key) || !textKey.includes(key)) continue
    seen.add(key)
    phraseKeys.push({ key })
  }
  phraseKeys.sort((a, b) => b.key.length - a.key.length)
  if (!phraseKeys.length) return [{ type: "text", value: text }]

  // Acumulamos rangos en posiciones del TEXTO ORIGINAL (no del needle).
  const ranges: { start: number; end: number }[] = []
  for (const { key } of phraseKeys) {
    let fromKey = 0
    while (fromKey <= textKey.length - key.length) {
      const idxKey = textKey.indexOf(key, fromKey)
      if (idxKey === -1) break
      // Traducir índices needle → original via textMap.
      // start = mapeo del primer char del match
      // end   = mapeo del char SIGUIENTE al match (o text.length si no hay)
      const lastNeedleIdx = idxKey + key.length - 1
      const start = textMap[idxKey]
      const end   = lastNeedleIdx + 1 < textMap.length
        ? textMap[lastNeedleIdx + 1]
        : text.length
      const overlaps = ranges.some((r) => start < r.end && end > r.start)
      if (!overlaps) ranges.push({ start, end })
      fromKey = idxKey + key.length
    }
  }

  if (!ranges.length) return [{ type: "text", value: text }]

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
