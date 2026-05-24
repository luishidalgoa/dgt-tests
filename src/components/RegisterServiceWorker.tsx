"use client"

import { useEffect } from "react"

/**
 * Registra `/sw.js` (Service Worker) en el navegador del cliente.
 *
 * Se monta una sola vez en el root layout. El register es idempotente
 * — si el browser ya tiene el SW activo, no hace nada nuevo; si hay
 * uno viejo, lo actualiza al detectar cambio en el archivo.
 *
 * Por qué un componente cliente y no inline `<script>` en layout: el
 * componente es la forma estándar en Next App Router (server-render
 * el layout, hidratar este componente para ejecutar registro). Más
 * limpio que `dangerouslySetInnerHTML` y evita warnings de hydration.
 *
 * No registramos en development (Next dev recarga muy a menudo y el
 * SW caché interfiere con HMR). Solo en producción.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return
    if (!("serviceWorker" in navigator)) return
    // Solo en producción — en dev el SW cachea assets que rotan y
    // confunde el HMR de Next.
    if (process.env.NODE_ENV !== "production") return

    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" })
      } catch {
        // Falla silenciosa: PWA es enhancement, no debe romper la app
        // si el browser bloquea SW (modo incógnito, permisos, etc.).
      }
    }
    // Lo retrasamos al "load" para no competir con la hidratación
    // inicial del primer paint.
    if (document.readyState === "complete") {
      void register()
    } else {
      window.addEventListener("load", () => { void register() }, { once: true })
    }
  }, [])
  return null
}
