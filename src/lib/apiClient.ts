/**
 * Wrapper de `fetch` que reporta automáticamente a Sentry los errores
 * HTTP inesperados que originan en NUESTRA UI.
 *
 * Uso: drop-in replacement de fetch para llamadas a `/api/*` propias.
 *
 *   import { apiFetch } from "@/lib/apiClient"
 *
 *   const res = await apiFetch("/api/attempts", { method: "POST", body })
 *   if (!res.ok) toast.error("Algo falló")
 *
 * Captura como `error` los 5xx, como `warning` los 4xx (excepto los
 * "esperados" — 401/403 son flujo normal de auth).
 *
 * Diferencias con el catchall server-side (`/api/[...slug]`):
 *  - Este se ejecuta en CLIENT — solo captura requests que SALEN de
 *    nuestra UI. Cero ruido de bots/scanners.
 *  - Sentry adjunta automáticamente el breadcrumb del componente que
 *    disparó el fetch.
 *  - Diferencia 4xx (warning) de 5xx (error) → mejor triage en Sentry.
 *
 * Conviene usarlo SIEMPRE para llamadas a `/api/*` propias. Para fetches
 * a CDNs externos (R2, imágenes) no — esos pasan por `next/image` u
 * otros mecanismos y los gestionan sus propios SDKs.
 */
import * as Sentry from "@sentry/nextjs"

/** Estados que NO se reportan a Sentry — son flujo normal de la app. */
const EXPECTED_4XX = new Set<number>([
  401, // auth fail — el redirect a /login es el comportamiento esperado
  403, // forbidden — el user intentó algo a lo que no tiene acceso
])

interface ApiFetchOptions extends RequestInit {
  /** Si quieres añadir códigos extra a la lista de "esperados" para
   *  un caso específico, los pasas aquí. Ej: { ignoreStatus: [409] }
   *  para un POST que tolera conflicts. */
  ignoreStatus?: number[]
}

export async function apiFetch(url: string, opts: ApiFetchOptions = {}): Promise<Response> {
  const { ignoreStatus = [], ...init } = opts
  const ignored = new Set<number>([...EXPECTED_4XX, ...ignoreStatus])

  let res: Response
  try {
    res = await fetch(url, init)
  } catch (err) {
    // Network error (DNS, offline, CORS bloqueado, timeout). Sentry NO
    // lo capta automáticamente en el catch del caller — lo reportamos
    // aquí porque sabemos que estamos haciendo una llamada a la app.
    Sentry.captureException(err, {
      level: "error",
      tags: {
        api_method: init.method ?? "GET",
        api_url:    url,
        api_kind:   "network_error",
      },
    })
    throw err
  }

  if (!res.ok && !ignored.has(res.status)) {
    Sentry.captureMessage(
      `API ${res.status}: ${init.method ?? "GET"} ${url}`,
      {
        level: res.status >= 500 ? "error" : "warning",
        tags: {
          api_status: String(res.status),
          api_method: init.method ?? "GET",
          api_url:    url,
        },
      },
    )
  }

  return res
}
