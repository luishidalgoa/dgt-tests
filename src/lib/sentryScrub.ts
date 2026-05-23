/**
 * `beforeSend` filter para Sentry — limpia PII antes de subir eventos.
 *
 * Reglas:
 *  - Quita `email` e `ip_address` del user
 *  - Redacta cualquier campo cuya KEY coincida con patrones sensibles
 *    (password, token, secret, api_key, cookie, authorization, stripe IDs).
 *    Funciona recursivo sobre extra/contexts/breadcrumbs.
 *  - Scrub de querystring en URLs de breadcrumbs (los IDs pueden ser PII)
 *
 * Por qué importa: aunque el código nuestro no envíe explicitamente
 * datos sensibles, Sentry captura automáticamente request bodies,
 * cookies, headers, etc. Sin scrubbing los emails de usuarios
 * terminarían en el dashboard de Sentry → violación RGPD.
 */
import type { ErrorEvent, EventHint } from "@sentry/nextjs"

const SENSITIVE_KEY_RE =
  /password|token|secret|api[_-]?key|cookie|authorization|stripe[_-]?(customer|sub|secret)|session/i

/** Redacta recursivamente cualquier valor en `obj` cuya KEY mate sensibles. */
function redact(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(redact)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      out[k] = "[REDACTED]"
    } else if (v !== null && typeof v === "object") {
      out[k] = redact(v)
    } else {
      out[k] = v
    }
  }
  return out
}

/** Limpia queries con tokens de URLs de breadcrumbs. */
function scrubUrl(url: string | undefined): string | undefined {
  if (!url) return url
  try {
    const u = new URL(url, "http://placeholder.invalid")
    let dirty = false
    for (const k of Array.from(u.searchParams.keys())) {
      if (SENSITIVE_KEY_RE.test(k)) {
        u.searchParams.set(k, "[REDACTED]")
        dirty = true
      }
    }
    return dirty ? u.toString().replace(/^http:\/\/placeholder\.invalid/, "") : url
  } catch {
    return url
  }
}

export function scrubPII(event: ErrorEvent, _hint?: EventHint): ErrorEvent | null {
  // user.email + user.ip_address fuera. id sí, para correlación.
  if (event.user) {
    delete event.user.email
    delete event.user.ip_address
  }

  // request body / cookies / headers
  if (event.request) {
    // cookies: tipado de Sentry es Record<string,string> | string; con
    // pasar string ya está cubierto (Sentry lo trata como blob plano).
    if (event.request.cookies) event.request.cookies = { _redacted: "[REDACTED]" }
    if (event.request.headers) event.request.headers = redact(event.request.headers) as typeof event.request.headers
    if (event.request.data) event.request.data = redact(event.request.data) as typeof event.request.data
    if (event.request.url) event.request.url = scrubUrl(event.request.url)
  }

  // breadcrumbs (URLs, fetch params, redux state, etc.)
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => ({
      ...b,
      data: b.data ? (redact(b.data) as typeof b.data) : b.data,
      message: typeof b.message === "string" ? b.message : b.message,
    }))
  }

  // contexts y extra (libre — los devs meten cualquier cosa)
  if (event.contexts) event.contexts = redact(event.contexts) as typeof event.contexts
  if (event.extra) event.extra = redact(event.extra) as typeof event.extra

  return event
}
