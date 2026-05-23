import { NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { requireAdmin } from "@/lib/adminGuard"
import { getEffectiveSecret } from "@/lib/secretCatalog"

/**
 * POST /api/admin/test-sentry
 *
 * Dispara un error a propósito para verificar que llega a Sentry.
 * Útil tras setup inicial o cambios de DSN/config.
 *
 * Tres modos según `mode` en el body:
 *  - "throw":    lanza una excepción no controlada (camino normal)
 *  - "capture":  llama explícitamente Sentry.captureException (default)
 *  - "message":  Sentry.captureMessage (warn level, no excepción)
 *
 * Respuesta:
 *  - { ok: false, error: "Sentry no inicializado", ... } si no hay DSN
 *  - { ok: true,  eventId, mode, sentryUrl } si todo bien
 *  - { ok: false, error: "..." } para otros fallos (red, etc.)
 *
 * Restricción: solo admin (requireAdmin notFound 404 si no lo es).
 */

const SENTRY_BASE = "https://luishidalgoa.sentry.io"

export async function POST(req: Request) {
  await requireAdmin()

  const body = await req.json().catch(() => ({})) as { mode?: string }
  const mode = body.mode ?? "capture"

  // Comprobar que Sentry está inicializado de verdad.
  // getClient() devuelve undefined si no hay init válido (DSN vacío,
  // init falló, etc.). Si init es async (nuestro caso, lo hace dentro
  // de un IIFE en sentry.server.config.ts), puede tardar unos ms en
  // estar listo tras cold start — damos hasta ~2s leyendo DSN config.
  let client = Sentry.getClient()
  if (!client) {
    // Comprobamos manualmente si HAY DSN configurado. Si lo hay pero
    // init aún no terminó, esperamos un poco. Si no hay DSN, devolvemos
    // error claro.
    const dsn = await getEffectiveSecret("NEXT_PUBLIC_SENTRY_DSN")
    if (!dsn) {
      return NextResponse.json({
        ok:    false,
        error: "Sentry no inicializado: NEXT_PUBLIC_SENTRY_DSN no está configurado (ni en /admin/secrets ni en env vars)",
      }, { status: 200 })
    }
    // DSN existe pero client aún no listo — esperamos 1s
    await new Promise((r) => setTimeout(r, 1000))
    client = Sentry.getClient()
    if (!client) {
      return NextResponse.json({
        ok:    false,
        error: "Sentry no inicializado: hay DSN pero el SDK no terminó de arrancar. Revisa los logs del servidor.",
      }, { status: 200 })
    }
  }

  if (mode === "throw") {
    // Tiramos la excepción sin try/catch — instrumentation.ts la
    // captura via captureRequestError y la sube a Sentry.
    throw new Error("[test-sentry] Intentional unhandled error from /api/admin/test-sentry")
  }

  let eventId: string | undefined
  if (mode === "message") {
    eventId = Sentry.captureMessage(
      "[test-sentry] Intentional message from /api/admin/test-sentry",
      "warning",
    )
  } else {
    eventId = Sentry.captureException(
      new Error("[test-sentry] Intentional captured exception from /api/admin/test-sentry"),
    )
  }

  if (!eventId) {
    return NextResponse.json({
      ok:    false,
      error: "Sentry aceptó la llamada pero no devolvió eventId — posible problema de red o configuración.",
    }, { status: 200 })
  }

  // Forzamos el flush a Sentry antes de responder. Sin esto, en lambdas
  // serverless el proceso puede terminar antes de subir el evento.
  // 2s timeout suficiente para conexiones normales.
  await Sentry.flush(2000)

  // URL para que el admin pueda ir directo a ver el evento en Sentry.
  // El formato "issues?query=event.id:..." muestra la issue que contiene
  // ese event_id concreto.
  const sentryUrl = `${SENTRY_BASE}/issues/?query=event.id%3A${eventId}`

  return NextResponse.json({ ok: true, eventId, mode, sentryUrl })
}
