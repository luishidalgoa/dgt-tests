/**
 * Utilidades para trabajar con los códigos de tema (codigoTema).
 *
 * El formato típico es `TC X.Y-Z.W (X-Y.Z)` donde:
 *   - `TC X.Y` (o `TC X`) = subtema visible en la UI ("La vía", "Peatones"…)
 *   - `-Z.W`              = subdivisión interna dentro del subtema
 *   - `(…)`               = codificación alternativa, ignorable para parsing
 *
 * Ejemplos reales (2676 preguntas, ~50 patrones):
 *   "TC 1.2-5.3 (1-2.5)"        →  prefix="TC 1.2", padre="TC 1", inner="5.3"
 *   "TC 7.3-3.1.3 (7-3.3.1)"    →  prefix="TC 7.3", padre="TC 7", inner="3.1.3"
 *   "TC 2.8 (2-8.1)"            →  prefix="TC 2.8", padre="TC 2", inner=null
 *   "TC 5-2.4 (5-2.4)"          →  prefix="TC 5",   padre="TC 5", inner="2.4"
 *   "TC 7.3-3.4_ADAS (7-3.4)"   →  prefix="TC 7.3", padre="TC 7", inner="3.4"
 *   "TC Def-2.2 (Def-2)"        →  prefix="TC Def", padre="TC Def", inner=null
 *
 * Bug histórico (corregido en Fase 96): la SQL antigua usaba
 * `INSTR(codigoTema, '-')` lo cual cortaba "TC 2.8 (2-8.1)" en "TC 2.8 (2".
 * Por eso aparecía una tarjeta huérfana "TC 2.8 (2" en la página /temas.
 */

const TEMA_NAMES: Record<string, string> = {
  "TC 1":    "La conducción",
  "TC 1.1":  "El conductor",
  "TC 1.2":  "La vía",
  "TC 1.3":  "El entorno",
  "TC 1.4":  "Normas generales",
  "TC 1.5":  "Velocidad",
  "TC 2":    "Otros usuarios",
  "TC 2.1":  "Peatones",
  "TC 2.2":  "Ciclistas",
  "TC 2.3":  "Motociclistas",
  "TC 2.4":  "Vehículos especiales",
  "TC 2.5":  "Camiones",
  "TC 2.6":  "Autobuses",
  "TC 2.7":  "Transporte escolar",
  "TC 2.8":  "Animales",
  "TC 3":    "Señalización",
  "TC 3.1":  "Agentes",
  "TC 3.2":  "Semáforos",
  "TC 3.3":  "Marcas viales",
  "TC 3.4":  "Carteles",
  "TC 3.5":  "Señales de peligro",
  "TC 3.6":  "Señales de prohibición",
  "TC 3.7":  "Señales de obligación",
  "TC 3.8":  "Señales de indicación",
  "TC 4":    "Maniobras",
  "TC 5":    "Estacionamiento",
  "TC 6":    "Alumbrado",
  "TC 7":    "Equipamiento del vehículo",
  "TC 7.1":  "Documentación",
  "TC 7.2":  "Mecánica",
  "TC 7.3":  "Seguridad activa y pasiva",
  "TC 7.4":  "Mantenimiento",
  "TC 8":    "Transporte de cargas",
  "TC 9":    "Accidentes",
  "TC 10":   "Cuestiones administrativas",
  "TC Def":  "Definiciones",
}

// ── PREFIJO (subtema visible) ────────────────────────────────────────────

/**
 * Extrae el prefijo de subtema visible, p.ej. "TC 1.2".
 *
 * Devuelve `null` si la entrada no es parseable (codigoTema vacío, solo "TC",
 * o un valor sin estructura reconocible). La UI agrupa esos en "Otros".
 *
 * Casos que acepta:
 *   - `TC X.Y` con o sin sufijos de subdivisión
 *   - `TC X`   (tema sin subtema decimal)
 *   - `TC Def` (definiciones del manual, 16 preguntas)
 */
export function extractTemaPrefix(codigoTema: string | null | undefined): string | null {
  if (!codigoTema) return null
  const trimmed = codigoTema.trim()
  if (!trimmed) return null
  // "TC " + (dígitos[.dígitos] | "Def")
  const m = trimmed.match(/^TC\s+(\d+(?:\.\d+)?|Def)\b/i)
  return m ? `TC ${m[1]}` : null
}

// ── TEMA PADRE (nivel 1 de la jerarquía) ─────────────────────────────────

/**
 * Dado un prefijo de subtema, devuelve el código del tema padre.
 * Ejemplo: `extractTemaPadre("TC 1.2")` → `"TC 1"`.
 *
 * Se usa para agrupar subtemas bajo un header común en /temas.
 */
export function extractTemaPadre(prefix: string | null | undefined): string | null {
  if (!prefix) return null
  const trimmed = prefix.trim()
  if (!trimmed) return null
  // "TC " + dígitos | "Def"  (descarta el sufijo .N si lo hay)
  const m = trimmed.match(/^TC\s+(\d+|Def)/i)
  return m ? `TC ${m[1]}` : null
}

// ── SUBDIVISIÓN INTERNA (nivel 2) ────────────────────────────────────────

/**
 * Devuelve la parte después del primer guion estructural, normalizada.
 * Ejemplo: `extractTemaInner("TC 1.2-5.3 (1-2.5)")` → `"5.3"`.
 *
 * Acepta sufijos como `_ADAS` y los descarta — se agrupan junto al resto
 * del mismo número (`3.4_ADAS` → `3.4`).
 *
 * Devuelve `null` cuando el codigoTema no tiene guion estructural — el
 * subtema es indivisible.
 */
export function extractTemaInner(codigoTema: string | null | undefined): string | null {
  if (!codigoTema) return null
  const trimmed = codigoTema.trim()
  if (!trimmed) return null
  // Buscamos el primer guion ANTES del paréntesis (la "parte exterior").
  const beforeParen = trimmed.split("(")[0].trim()
  const dashIdx = beforeParen.indexOf("-")
  if (dashIdx < 0) return null
  const tail = beforeParen.slice(dashIdx + 1).trim()
  if (!tail) return null
  // Normalizar: quitar sufijos tipo _ADAS conservando solo dígitos y puntos.
  const m = tail.match(/^(\d+(?:\.\d+)*)/)
  return m ? m[1] : null
}

// ── NOMBRES LEGIBLES ─────────────────────────────────────────────────────

export function getTemaName(code: string): string {
  return TEMA_NAMES[code] ?? code
}

/**
 * Devuelve el nombre legible del tema padre (`TC 1` → "La conducción").
 * Si no hay mapeo, devuelve el código tal cual.
 */
export function getTemaPadreName(padre: string): string {
  return TEMA_NAMES[padre] ?? padre
}

// ── CLASIFICACIÓN A 3 NIVELES (Tema > Bloque > SubBloque) ────────────────

export interface TemaClassification {
  /** Código del tema padre, sin "TC ". Ej: "1", "4", "Def". */
  padreCode:  string
  /** Código del bloque, sin "TC ". Ej: "1.2", "4.1", "Def.2". */
  bloqueCode: string
  /** Código del sub-bloque, sin "TC ". Ej: "1.2.5.3". `null` si la pregunta
   *  cae directamente en el bloque sin más profundidad. */
  subCode:    string | null
}

/**
 * Mapea un `codigoTema` a su (Tema padre, Bloque, SubBloque) jerárquico.
 *
 * Regla clave: los temas SIN subtema decimal en BBDD (TC 4, TC 5, TC 6,
 * TC 8, TC 9, TC 10, TC Def) usan el PRIMER segmento del inner como
 * bloque, para casar con la numeración del manual oficial. Por ejemplo
 * `TC 4-2.2.1` se clasifica como bloque "4.2", sub-bloque "4.2.2.1".
 *
 * Los temas CON subtema decimal (TC 1.2, TC 7.3…) usan el prefix como
 * bloque directamente.
 *
 * Devuelve `null` si el codigoTema no es parseable.
 */
export function classifyCodigoTema(codigoTema: string | null | undefined): TemaClassification | null {
  if (!codigoTema) return null
  const prefix = extractTemaPrefix(codigoTema)
  if (!prefix) return null
  const padre = extractTemaPadre(prefix) ?? prefix
  const inner = extractTemaInner(codigoTema)

  const padreCode = padre.replace(/^TC\s+/, "")
  const hasSubtemaDecimal = prefix !== padre

  if (hasSubtemaDecimal) {
    const bloqueCode = prefix.replace(/^TC\s+/, "")
    const subCode    = inner ? `${bloqueCode}.${inner}` : null
    return { padreCode, bloqueCode, subCode }
  }

  // Tema sin subtema decimal — el primer segmento del inner pasa a bloque
  if (!inner) {
    // codigoTema sin guion estructural ("TC 4 (4) (4)"). Pregunta huérfana
    // que metemos en un bloque "general" X.0 sin sub-bloque.
    return {
      padreCode,
      bloqueCode: `${padreCode}.0`,
      subCode:    null,
    }
  }
  const parts = inner.split(".")
  const bloqueCode = `${padreCode}.${parts[0]}`
  const rest = parts.slice(1).join(".")
  const subCode = rest ? `${bloqueCode}.${rest}` : null
  return { padreCode, bloqueCode, subCode }
}

// ── ORDEN NUMÉRICO ───────────────────────────────────────────────────────

/**
 * Comparator para ordenar códigos de tema/subtema numéricamente.
 * Sin esto, `localeCompare` mete "TC 10" antes que "TC 2".
 * "TC Def" se sortea al final (sentido: definiciones no son un tema numerado).
 *
 * Uso: `temas.sort((a, b) => compareTemaCodes(a.prefix, b.prefix))`
 */
export function compareTemaCodes(a: string, b: string): number {
  const ka = temaSortKey(a)
  const kb = temaSortKey(b)
  if (ka[0] !== kb[0]) return ka[0] - kb[0]
  if (ka[1] !== kb[1]) return ka[1] - kb[1]
  return a.localeCompare(b)
}

function temaSortKey(prefix: string): [number, number] {
  const m = prefix.match(/^TC\s+(Def|\d+)(?:\.(\d+))?/i)
  if (!m) return [99_999, 0]
  const padre = m[1].toLowerCase() === "def" ? 9_000 : parseInt(m[1], 10)
  const sub   = m[2] ? parseInt(m[2], 10) : 0
  return [padre, sub]
}
