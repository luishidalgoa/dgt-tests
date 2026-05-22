/**
 * Lector tipado del catálogo `src/data/manualIndice.json`.
 *
 * El JSON tiene la jerarquía (Tema > Bloque > SubBloque) con TÍTULOS
 * legibles. Las consultas aquí son SOLO de títulos — el conteo de
 * preguntas (`_preguntas` del JSON) NO se usa en runtime: las páginas
 * cuentan en directo contra la BBDD para reflejar siempre el estado
 * real (incluido preguntas IA aprobadas recientemente).
 *
 * Convención de input: aceptamos tanto el código nativo del JSON
 * ("1", "1.2", "1.2.5.3") como el "TC " prefixed que viene de los
 * codigoTema ("TC 1", "TC 1.2", "TC Def"). Internamente quitamos el
 * prefijo antes de la lookup.
 *
 * El catálogo se carga una sola vez al importar este módulo. Los
 * Maps de índice se construyen al inicio para que getXxxInfo() sea
 * O(1).
 */

import manualIndiceRaw from "@/data/manualIndice.json"

interface SubBloqueRaw {
  codigo:     string
  titulo:     string
  _preguntas: number
}
interface BloqueRaw {
  codigo:     string
  titulo:     string
  _preguntas: number
  subBloques: SubBloqueRaw[]
}
interface TemaRaw {
  codigo:     string
  titulo:     string
  _preguntas: number
  bloques:    BloqueRaw[]
}

const INDICE = manualIndiceRaw as TemaRaw[]

// ── Índices construidos al cargar ────────────────────────────────────────

const temaByCode      = new Map<string, TemaRaw>()
const bloqueByCode    = new Map<string, { bloque: BloqueRaw; tema: TemaRaw }>()
const subBloqueByCode = new Map<string, { sub: SubBloqueRaw; bloque: BloqueRaw; tema: TemaRaw }>()

for (const t of INDICE) {
  temaByCode.set(t.codigo, t)
  for (const b of t.bloques) {
    bloqueByCode.set(b.codigo, { bloque: b, tema: t })
    for (const s of b.subBloques) {
      subBloqueByCode.set(s.codigo, { sub: s, bloque: b, tema: t })
    }
  }
}

/** Quita el prefijo "TC " si lo lleva. "TC 1.2" → "1.2", "1.2" → "1.2". */
function stripTC(code: string): string {
  return code.replace(/^TC\s+/, "").trim()
}

// ── API pública ──────────────────────────────────────────────────────────

export interface TemaInfo {
  /** Código sin prefijo, ej "1" o "Def". */
  codigo: string
  /** Título legible, ej "El uso de las vías". */
  titulo: string
}

export interface BloqueInfo extends TemaInfo {
  /** Código + título del tema padre. */
  temaCodigo: string
  temaTitulo: string
}

export interface SubBloqueInfo extends BloqueInfo {
  /** Código + título del bloque padre. */
  bloqueCodigo: string
  bloqueTitulo: string
}

/**
 * Información del tema. Acepta "1", "TC 1", "Def", "TC Def".
 * Devuelve null si el código no está en el catálogo.
 */
export function getTemaInfo(code: string): TemaInfo | null {
  const tema = temaByCode.get(stripTC(code))
  if (!tema || !tema.titulo) return null
  return { codigo: tema.codigo, titulo: tema.titulo }
}

/**
 * Información del bloque + tema padre. Acepta "1.2" o "TC 1.2".
 */
export function getBloqueInfo(code: string): BloqueInfo | null {
  const item = bloqueByCode.get(stripTC(code))
  if (!item || !item.bloque.titulo) return null
  return {
    codigo:     item.bloque.codigo,
    titulo:     item.bloque.titulo,
    temaCodigo: item.tema.codigo,
    temaTitulo: item.tema.titulo,
  }
}

/**
 * Información del sub-bloque + bloque padre + tema padre. Acepta
 * códigos jerárquicos "1.2.5.3" sin prefijo TC.
 */
export function getSubBloqueInfo(code: string): SubBloqueInfo | null {
  const item = subBloqueByCode.get(code)
  if (!item || !item.sub.titulo) return null
  return {
    codigo:       item.sub.codigo,
    titulo:       item.sub.titulo,
    bloqueCodigo: item.bloque.codigo,
    bloqueTitulo: item.bloque.titulo,
    temaCodigo:   item.tema.codigo,
    temaTitulo:   item.tema.titulo,
  }
}

/**
 * Devuelve los sub-bloques (con título) de un bloque dado, en orden
 * del catálogo. Útil para mostrar la jerarquía completa en /admin.
 */
export function listSubBloques(bloqueCode: string): SubBloqueRaw[] {
  const item = bloqueByCode.get(stripTC(bloqueCode))
  return item ? item.bloque.subBloques : []
}
