/**
 * Wrapper server-side para enviar eventos a Umami desde código que NO se
 * ejecuta en el navegador (webhooks, server actions, route handlers).
 *
 * El cliente `analytics.ts` usa `window.umami.track()`, que no existe en
 * server. Aquí hacemos una llamada HTTP directa al endpoint /api/send de
 * Umami con el formato que espera (idéntico al payload que el script
 * inyectado en el navegador envía).
 *
 * Diseño:
 *   - No-op si NEXT_PUBLIC_ANALYTICS_WEBSITE_ID no está configurado
 *     (preview/local sin analytics).
 *   - Fire-and-forget con timeout corto: si Umami está lento, NO bloqueamos
 *     el webhook de Stripe (mucho peor perder un cobro por timeout que
 *     perder una métrica).
 *   - Catch silencioso: analytics es soft, NO debe romper flujos críticos.
 *   - Sin PII: solo agregados serializables (igual que el cliente).
 *
 * El consent banner no aplica aquí — server-side no tiene localStorage del
 * user. La justificación es que estos eventos se disparan tras una acción
 * explícita del user (e.g. cancelar suscripción) y son operaciones del
 * negocio, no tracking de comportamiento de navegación.
 */

import type { AnalyticsEvent, AnalyticsProps } from "@/lib/analytics"

const WEBSITE_ID = process.env.NEXT_PUBLIC_ANALYTICS_WEBSITE_ID ?? ""
const SCRIPT_URL = process.env.NEXT_PUBLIC_ANALYTICS_SCRIPT_URL ?? ""
const APP_URL    = process.env.NEXT_PUBLIC_APP_URL ?? "https://dgt-tests.hdglabs.com"

const HOSTNAME = APP_URL
  .replace(/^https?:\/\//, "")
  .replace(/\/.*$/, "")  // quitar paths si los hubiera

/**
 * Deriva la URL del endpoint /api/send de Umami a partir del script URL.
 *   "https://cloud.umami.is/script.js"  →  "https://cloud.umami.is/api/send"
 *   "https://stats.example.com/u.js"    →  "https://stats.example.com/api/send"
 *
 * Devuelve null si el script URL no está configurado o no es válido.
 */
function getUmamiSendUrl(): string | null {
  if (!SCRIPT_URL) return null
  try {
    const u = new URL(SCRIPT_URL)
    return `${u.origin}/api/send`
  } catch {
    return null
  }
}

/**
 * Dispara un evento a Umami desde server. No throwea nunca.
 *
 * @param name   Tipado contra el catálogo en analytics.ts — usa los mismos
 *               nombres que el cliente para que el dashboard de Umami no
 *               tenga eventos duplicados con nombres ligeramente distintos.
 * @param props  Props del evento (sin PII). Se serializan como JSON dentro
 *               de payload.data.
 * @param ctx    Contexto opcional: la URL "lógica" del evento (default:
 *               "/server-event"). Útil para diferenciar en el dashboard
 *               eventos server-side de los client-side del mismo nombre.
 */
export async function trackEventServer(
  name: AnalyticsEvent,
  props?: AnalyticsProps,
  ctx?: { url?: string },
): Promise<void> {
  if (!WEBSITE_ID) return  // no configurado → noop silencioso

  const sendUrl = getUmamiSendUrl()
  if (!sendUrl) return

  // Formato exacto que espera Umami v2 (mismo que envía el script del
  // navegador). El `screen` 0x0 indica server-side, útil para filtrar en
  // el dashboard si quisiéramos.
  const body = {
    type: "event",
    payload: {
      website:  WEBSITE_ID,
      hostname: HOSTNAME,
      language: "es-ES",
      url:      ctx?.url ?? "/server-event",
      referrer: "",
      screen:   "0x0",
      title:    "",
      name,
      ...(props ? { data: props } : {}),
    },
  }

  try {
    await fetch(sendUrl, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        // Umami requiere un User-Agent (lo usa para bot detection); le
        // mandamos uno explícito identificable para que admin pueda
        // distinguir eventos server-side en logs si hace falta.
        "User-Agent":   "DGT-Tests-Server/1.0",
      },
      body:    JSON.stringify(body),
      // Si Umami tarda >2s, abortamos. Mejor perder el evento que retrasar
      // la respuesta al webhook de Stripe (que reintentaría todo el evento).
      signal:  AbortSignal.timeout(2000),
    })
  } catch {
    // Silencio total: analytics es soft, ni siquiera lo logueamos en
    // Sentry — un Umami lento o caído no es un error de la app.
  }
}
