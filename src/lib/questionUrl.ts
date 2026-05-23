/**
 * Helpers para URLs SEO de preguntas individuales.
 *
 * Cada pregunta accesible públicamente (tier=FREE) tiene una URL única
 * de la forma:
 *
 *   /preguntas/permiso-b/<slug-con-id-al-final>
 *
 * El slug es el enunciado kebab-cased + el id numérico interno como
 * sufijo (`-12345`). El sufijo garantiza:
 *   - Unicidad (dos enunciados parecidos no colisionan).
 *   - Parsing barato (regex `/-(\d+)$/` extrae el id sin BBDD).
 *   - URLs estables aunque cambie el enunciado (el id no se mueve).
 *
 * Estos URLs alimentan el sitemap.xml y son la principal palanca SEO
 * long-tail del sitio — cada uno rankea por su query exacta tipo
 * "puede un coche llevar solamente el espejo exterior izquierdo".
 */

const DIACRITIC_MAP: Record<string, string> = {
  á: "a", é: "e", í: "i", ó: "o", ú: "u", ñ: "n", ü: "u",
  Á: "a", É: "e", Í: "i", Ó: "o", Ú: "u", Ñ: "n", Ü: "u",
}

/** Quita tildes y ñ → ascii equivalentes. */
function stripDiacritics(s: string): string {
  return s.replace(/[áéíóúñüÁÉÍÓÚÑÜ]/g, (c) => DIACRITIC_MAP[c] ?? c)
}

/** Longitud máxima de la parte de texto del slug (sin contar el sufijo
 *  -id). Truncar en >80 chars evita URLs gigantes (mal vistas por
 *  Google y feas al compartir). Cortamos en límite de palabra. */
const MAX_TEXT_LENGTH = 80

/**
 * Convierte el enunciado de una pregunta en un slug URL-safe terminado
 * en el id numérico:
 *
 *   { id: 12345, enunciado: "¿Puede un coche llevar solamente...?" }
 *   → "puede-un-coche-llevar-solamente-12345"
 *
 * El id al final es CRÍTICO — sin él, dos enunciados similares
 * colisionarían y no podríamos resolver la URL.
 */
export function questionToSlug(question: { id: number; enunciado: string }): string {
  const text = stripDiacritics(question.enunciado.toLowerCase())
    // Quita puntuación común — incluyendo ¿? ¡! que abundan en preguntas
    // DGT, y comillas, paréntesis, puntos, comas, etc.
    .replace(/[¿?¡!.,:;"'`´()[\]{}/\\]/g, "")
    // Cualquier secuencia de espacios o tabs → un guion
    .replace(/[\s\t]+/g, "-")
    // Quita TODO lo que no sea alfanumérico o guion (por si quedó algún
    // símbolo raro tipo €, %, ª…).
    .replace(/[^a-z0-9-]/g, "")
    // Dedupe guiones consecutivos (de la limpieza anterior pueden quedar)
    .replace(/-+/g, "-")
    // Trim guiones de los extremos
    .replace(/^-+|-+$/g, "")

  let truncated = text
  if (text.length > MAX_TEXT_LENGTH) {
    truncated = text.slice(0, MAX_TEXT_LENGTH)
    // Corta en límite de palabra si hay un guion cercano al límite.
    // Si el último guion está demasiado cerca del inicio (<40), no
    // recortamos para conservar contexto.
    const lastDash = truncated.lastIndexOf("-")
    if (lastDash > 40) truncated = truncated.slice(0, lastDash)
  }

  return `${truncated}-${question.id}`
}

/**
 * Extrae el id numérico del final del slug.
 *
 *   "puede-un-coche-llevar-12345" → 12345
 *   "slug-sin-id"                 → null
 *
 * Se usa en /preguntas/[categoria]/[slug]/page.tsx para resolver el
 * documento desde la URL sin tener que recorrer toda la tabla.
 */
export function questionIdFromSlug(slug: string): number | null {
  const m = slug.match(/-(\d+)$/)
  if (!m) return null
  const id = parseInt(m[1], 10)
  return Number.isInteger(id) && id > 0 ? id : null
}
