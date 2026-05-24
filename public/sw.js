/**
 * Service Worker mínimo para que la app sea "installable" según
 * Chrome (uno de los criterios PWA junto con manifest válido + HTTPS
 * + iconos). Sirve también como cache shell muy básico:
 *
 *   - "network-first" para HTML/data (siempre fresco — la app es
 *     muy dinámica: tests, IA, sesión)
 *   - "cache-first" para assets estáticos (JS, CSS, fonts, imágenes
 *     del CDN) — esos no cambian a menudo
 *
 * Limitación deliberada: NO cacheamos endpoints /api/ (todo es POST
 * o requiere sesión), NO hacemos background sync, NO hacemos offline
 * real de tests (eso requiere IndexedDB + queue de respuestas, otro
 * issue). Esta versión solo cumple el mínimo PWA para que el sitio
 * sea instalable.
 *
 * Versión del cache — bump cuando cambies este SW para que los
 * clientes purguen el viejo. Si no, Chrome se queda con el SW antiguo
 * hasta el siguiente "Update on reload" o navegación post-skipWaiting.
 */
const CACHE_VERSION = "v1-2026-05-25"
const CACHE_NAME    = `dgt-tests-${CACHE_VERSION}`

// ── install: activa SW nuevo inmediatamente sin esperar ──────────────
self.addEventListener("install", (event) => {
  // skipWaiting → no esperar a que cierren todas las pestañas viejas.
  // En una app con poco state-en-memoria es seguro; reduce el tiempo
  // de despliegue percibido.
  self.skipWaiting()
})

// ── activate: borra caches con otra versión ──────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith("dgt-tests-") && k !== CACHE_NAME)
          .map((k) => caches.delete(k)),
      ),
    ),
  )
  // claim → controla las pestañas abiertas inmediatamente.
  self.clients.claim()
})

// ── fetch: cache-first para estáticos, network-first para el resto ───
self.addEventListener("fetch", (event) => {
  const req = event.request

  // Solo GET (POSTs van directos a red).
  if (req.method !== "GET") return

  const url = new URL(req.url)

  // Ignora extensiones de navegador y otros origins raros.
  if (url.origin !== self.location.origin && !isCDN(url)) return

  // Estáticos de Next + R2 imágenes → cache-first (no cambian sin redeploy).
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image") ||
    isCDN(url)
  ) {
    event.respondWith(cacheFirst(req))
    return
  }

  // Resto (HTML, manifest, sw, etc.) → network-first con fallback a cache
  // si el user está offline.
  event.respondWith(networkFirst(req))
})

function isCDN(url) {
  // R2 CDN público de imágenes de preguntas.
  return url.hostname.endsWith(".r2.dev")
}

async function cacheFirst(req) {
  const cached = await caches.match(req)
  if (cached) return cached
  try {
    const res = await fetch(req)
    if (res.ok) {
      const cache = await caches.open(CACHE_NAME)
      cache.put(req, res.clone()).catch(() => {})
    }
    return res
  } catch {
    // Sin red y sin cache → devolvemos respuesta vacía para no romper layout.
    return new Response("", { status: 504, statusText: "Offline" })
  }
}

async function networkFirst(req) {
  try {
    const res = await fetch(req)
    return res
  } catch {
    const cached = await caches.match(req)
    if (cached) return cached
    return new Response("", { status: 504, statusText: "Offline" })
  }
}
