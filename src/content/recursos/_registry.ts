/**
 * Registry de artículos /recursos.
 *
 * Cada artículo es un módulo .tsx con dos exports:
 *   - `meta`:    RecursoMeta (slug, title, description, fechas, etc.)
 *   - `default`: ComponentType (JSX del cuerpo, sin H1 — el H1 lo
 *                pone el layout de [slug]/page.tsx desde meta.title)
 *
 * Este registry los importa todos y los expone en un array ordenado
 * por publishedAt desc (último arriba), que usa el índice /recursos.
 * También expone `findRecurso(slug)` para la ruta dinámica.
 *
 * Cuando añadas un nuevo artículo: créalo en este directorio + súmalo
 * al array RECURSOS de abajo. Aparecerá automáticamente en el índice,
 * en el sitemap y en el JSON-LD del index.
 */

import type { ComponentType } from "react"
import * as art1 from "./cuanto-cuesta-carne-2026"
import * as art2 from "./cuantos-fallos-teorico-dgt"
import * as art3 from "./test-adas-dgt"

export interface RecursoMeta {
  /** Slug URL-safe sin / inicial. Aparece como /recursos/[slug]. */
  slug:            string
  /** Título completo. Va al <h1>, al <title> y a Article schema headline. */
  title:           string
  /** Description meta + OG. 120-160 chars idealmente. */
  description:     string
  /** Frase corta para la card del índice (subtítulo). ~80-120 chars. */
  excerpt:         string
  /** Fecha de publicación inicial. ISO 8601 (YYYY-MM-DD). */
  publishedAt:     string
  /** Fecha de última modificación (default = publishedAt). */
  updatedAt:       string
  /** Tiempo de lectura estimado en minutos. */
  readingMinutes:  number
  /** Tag de tema — futuro: filtrar índice por categoría. */
  topic:           "examen" | "coste" | "adas" | "guia"
}

export interface RecursoEntry {
  meta:      RecursoMeta
  Component: ComponentType
}

// Orden manual: lo más reciente / con mayor valor SEO primero.
export const RECURSOS: RecursoEntry[] = [
  { meta: art1.meta, Component: art1.default },
  { meta: art2.meta, Component: art2.default },
  { meta: art3.meta, Component: art3.default },
]

/** Devuelve el artículo de un slug o undefined si no existe. */
export function findRecurso(slug: string): RecursoEntry | undefined {
  return RECURSOS.find((r) => r.meta.slug === slug)
}

/** Devuelve hasta `limit` artículos distintos del `excludeSlug`. */
export function relatedRecursos(excludeSlug: string, limit: number = 2): RecursoEntry[] {
  return RECURSOS.filter((r) => r.meta.slug !== excludeSlug).slice(0, limit)
}
