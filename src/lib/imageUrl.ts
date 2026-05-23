/**
 * Devuelve la URL completa para una imagen de pregunta DGT.
 *
 * Comportamiento:
 *  - Si NEXT_PUBLIC_IMAGE_CDN_URL está configurado (prod), devuelve
 *    `${CDN_URL}/${filename}` apuntando al CDN externo (Cloudflare R2,
 *    Firebase Storage, lo que sea).
 *  - Si está vacío (dev local sin CDN), cae a `/images/${filename}`
 *    que sirve Next dev server desde `/public/images/`.
 *
 * Esto permite que dev y prod usen la misma API sin tocar código —
 * solo cambias la env var.
 *
 * Por qué: tras Fase 3 las 2.646 PNG de tests viven en CDN externo, no
 * en el bundle de Vercel. El repo se queda limpio (~127MB menos en git
 * clones) y Vercel no las trace en los lambdas (otro factor que en
 * Fase 3 nos hizo superar el límite 250MB).
 */
const CDN_URL = (process.env.NEXT_PUBLIC_IMAGE_CDN_URL ?? "").replace(/\/$/, "")

export function imageUrl(filename: string): string {
  if (CDN_URL) return `${CDN_URL}/${filename}`
  return `/images/${filename}`
}

/** Igual que imageUrl pero garantiza URL ABSOLUTA (con esquema https).
 *  Útil para `fetch()` server-side donde una URL relativa no funciona.
 *  Si el CDN está configurado lo usa; si no, construye desde APP_URL.
 */
export function absoluteImageUrl(filename: string): string {
  if (CDN_URL) return `${CDN_URL}/${filename}`
  const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://dgt-tests.vercel.app").replace(/\/$/, "")
  return `${APP_URL}/images/${filename}`
}
