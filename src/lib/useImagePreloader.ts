"use client"

import { useEffect, useRef } from "react"

/**
 * Precarga imágenes en segundo plano para warm-up del cache del navegador
 * y del Service Worker.
 *
 * Caso de uso típico: el `ExamRunner` muestra una pregunta a la vez —
 * sólo la imagen "actual" se descarga al renderizarla. Si el user navega
 * rápido vía el mapa de preguntas (sin verlas todas) y llega a la pantalla
 * de resultados, ahí se renderizan las 30 imágenes a la vez → tirón de red.
 *
 * Este hook arregla eso disparando `new Image()` para TODAS las URLs al
 * montar el runner. El navegador descarga en paralelo en background, el
 * Service Worker (sw.js) intercepta los requests del CDN R2 (isCDN check)
 * y los guarda en Cache Storage. Cuando results renderice, mismo URL =
 * cache hit, cero red.
 *
 * Para que ESTO funcione, la URL precargada debe coincidir EXACTAMENTE
 * con la URL que `<Image>` de next/image acabará pidiendo. Por eso los
 * componentes que muestren estas imgs deben usar `unoptimized` — así
 * la URL servida es el CDN directo, sin transformación a `/_next/image`.
 *
 * Uso:
 *
 *   const urls = useMemo(
 *     () => questions.map(q => q.imagen ? imageUrl(q.imagen) : null),
 *     [questions]
 *   )
 *   useImagePreloader(urls)
 *
 * Notas:
 *   - No-op en server (no `window`) ni con array vacío.
 *   - Dedupea internamente: si el componente re-renderiza con las mismas
 *     URLs, no relanza los fetches.
 *   - `fetchPriority="low"` para no robar bandwidth a la imagen actual
 *     (que ya está en el DOM con prioridad normal).
 *   - `decoding="async"` → procesado off-main-thread; no bloquea la UI.
 *   - Fire-and-forget: no devolvemos progreso ni errores. Si una imagen
 *     falla, el render normal la pedirá igual en su momento.
 *   - Sin cleanup explícito en unmount: las requests en vuelo terminan
 *     en background y, si llegan, quedan cacheadas (puro beneficio).
 *     `new Image()` no expone cancel API.
 */
export function useImagePreloader(urls: readonly (string | null | undefined)[]): void {
  // Track de URLs ya lanzadas en esta vida del componente para no
  // relanzar fetches si el caller re-renderiza con el mismo array.
  const seenRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (typeof window === "undefined") return

    // Filtrar nulls/empty + dedup contra lo ya lanzado
    const fresh: string[] = []
    for (const u of urls) {
      if (!u) continue
      if (seenRef.current.has(u)) continue
      seenRef.current.add(u)
      fresh.push(u)
    }
    if (fresh.length === 0) return

    for (const src of fresh) {
      const img = new Image()
      // 'fetchPriority' es relativamente nuevo (Chrome 102+, Safari 17.2+).
      // Lo seteamos via feature detection — en browsers viejos se ignora.
      if ("fetchPriority" in img) {
        (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = "low"
      }
      img.decoding = "async"
      // Asignar src dispara el fetch — el navegador no espera a que el
      // <img> entre en el DOM (de hecho, nunca lo hace en este hook).
      img.src = src
    }
  }, [urls])
}
