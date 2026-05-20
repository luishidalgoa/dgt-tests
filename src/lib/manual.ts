/**
 * Mapping entre el codigoTema de una pregunta y la sección del manual.
 *
 * Ejemplos de codigoTema de las preguntas:
 *    "TC 7.3-3.1.3 (7-3.3.1)"   → subtema 7.3
 *    "TC 1.4-3.1 (1-4.3)"       → subtema 1.4
 *    "TC 5-2.4 (5-2.4)"         → tema 5  (sin subtema)  → buscamos "5.1" como fallback
 */

import { db } from "@/lib/db"

export interface ManualPage {
  index:          number
  page_in_book:   number | null
  topic_detected: string | null
  filename:       string
}

export interface ManualSectionData {
  id:           number
  temaCode:     string
  temaName:     string
  subtemaCode:  string
  subtemaName:  string
  folder:       string
  totalPages:   number
  pages:        ManualPage[]
  pdfFilename:  string | null
}


/** Extrae el código de subtema "X.Y" del campo codigoTema de una pregunta. */
export function extractSubtemaCode(codigoTema: string | null | undefined): string | null {
  if (!codigoTema) return null
  // Patrón: "TC X.Y" o "TC X" al principio
  const m = codigoTema.match(/^TC\s+(\d{1,2}(?:\.\d{1,2})?)/i)
  return m ? m[1] : null
}


/**
 * Devuelve la sección del manual asociada al codigoTema, o null si no se
 * puede mapear. Si el código es solo de tema (sin subtema), intenta el primer
 * subtema (X.1) como aproximación.
 */
export async function findManualSection(
  codigoTema: string | null | undefined
): Promise<ManualSectionData | null> {
  const code = extractSubtemaCode(codigoTema)
  if (!code) return null

  // Intento directo
  let section = await db.manualSection.findUnique({ where: { subtemaCode: code } })

  // Fallback: si el código es solo "X" (sin punto), probar "X.1"
  if (!section && !code.includes(".")) {
    section = await db.manualSection.findUnique({ where: { subtemaCode: `${code}.1` } })
  }

  if (!section) return null

  return {
    id:           section.id,
    temaCode:     section.temaCode,
    temaName:     section.temaName,
    subtemaCode:  section.subtemaCode,
    subtemaName:  section.subtemaName,
    folder:       section.folder,
    totalPages:   section.totalPages,
    pages:        JSON.parse(section.pages) as ManualPage[],
    pdfFilename:  section.pdfFilename,
  }
}


/**
 * Versión por lotes: dado un array de codigoTema, devuelve un mapa
 * { codigoTema → ManualSectionData } con una sola query.
 */
export async function findManualSectionsForCodes(
  codigos: (string | null | undefined)[]
): Promise<Map<string, ManualSectionData>> {
  const validCodes = new Set<string>()
  for (const c of codigos) {
    const code = extractSubtemaCode(c)
    if (code) validCodes.add(code)
  }
  if (validCodes.size === 0) return new Map()

  // Construir lista de candidatos (incluyendo fallback X.1)
  const candidates = new Set<string>(validCodes)
  for (const c of validCodes) {
    if (!c.includes(".")) candidates.add(`${c}.1`)
  }

  const sections = await db.manualSection.findMany({
    where: { subtemaCode: { in: Array.from(candidates) } },
  })

  const byCode = new Map<string, ManualSectionData>()
  for (const s of sections) {
    byCode.set(s.subtemaCode, {
      id:           s.id,
      temaCode:     s.temaCode,
      temaName:     s.temaName,
      subtemaCode:  s.subtemaCode,
      subtemaName:  s.subtemaName,
      folder:       s.folder,
      totalPages:   s.totalPages,
      pages:        JSON.parse(s.pages) as ManualPage[],
      pdfFilename:  s.pdfFilename,
    })
  }

  // Resolver con fallback para los códigos de tema sin subtema
  const result = new Map<string, ManualSectionData>()
  for (const codigoTema of codigos) {
    if (!codigoTema) continue
    const code = extractSubtemaCode(codigoTema)
    if (!code) continue
    let sec = byCode.get(code)
    if (!sec && !code.includes(".")) sec = byCode.get(`${code}.1`)
    if (sec) result.set(codigoTema, sec)
  }
  return result
}
