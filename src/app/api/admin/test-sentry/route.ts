import { NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { requireAdmin } from "@/lib/adminGuard"

/**
 * POST /api/admin/test-sentry
 *
 * Dispara un error a propósito para verificar que llega a Sentry.
 * Útil tras setup inicial o cambios de DSN/config.
 *
 * Tres modos según `mode` en el body:
 *  - "throw":    lanza una excepción no controlada (camino normal)
 *  - "capture":  llama explícitamente Sentry.captureException
 *  - "message":  Sentry.captureMessage (warn level, no excepción)
 *
 * Restricción: solo admin (requireAdmin notFound 404 si no lo es).
 */

export async function POST(req: Request) {
  await requireAdmin()

  const body = await req.json().catch(() => ({})) as { mode?: string }
  const mode = body.mode ?? "capture"

  if (mode === "throw") {
    // Tiramos la excepción sin try/catch — instrumentation.ts la
    // captura via captureRequestError y la sube a Sentry.
    throw new Error("[test-sentry] Intentional unhandled error from /api/admin/test-sentry")
  }

  if (mode === "message") {
    const eventId = Sentry.captureMessage(
      "[test-sentry] Intentional message from /api/admin/test-sentry",
      "warning",
    )
    return NextResponse.json({ ok: true, eventId, mode })
  }

  // Default: captureException
  const eventId = Sentry.captureException(
    new Error("[test-sentry] Intentional captured exception from /api/admin/test-sentry"),
  )
  return NextResponse.json({ ok: true, eventId, mode })
}
