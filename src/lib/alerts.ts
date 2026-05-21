/**
 * Avisos por email cuando algo crítico falla.
 *
 * Usa Resend (https://resend.com) — la free tier vale para alertas. Necesita:
 *   RESEND_API_KEY     → API key de Resend
 *   ALERT_EMAIL        → email donde enviar las alertas
 *   ALERT_FROM         → opcional, sender (por defecto onboarding@resend.dev)
 *
 * Rate-limit en memoria: máximo 1 email por hora por tipo, para no spamear
 * cuando la cuota está rota y cada request falla.
 */

const RATE_LIMIT_MS = 60 * 60 * 1000 // 1 hora
const lastSentByKey = new Map<string, number>()

interface SendOptions {
  /** Identificador del tipo de alerta — para el rate limit. */
  key:     string
  subject: string
  html:    string
}

async function sendEmail({ key, subject, html }: SendOptions): Promise<void> {
  // 1. Rate limit
  const now = Date.now()
  const last = lastSentByKey.get(key) ?? 0
  if (now - last < RATE_LIMIT_MS) {
    return
  }
  lastSentByKey.set(key, now)

  // 2. Config
  const apiKey = process.env.RESEND_API_KEY
  const to     = process.env.ALERT_EMAIL
  const from   = process.env.ALERT_FROM ?? "DGT Tests Alerts <onboarding@resend.dev>"

  if (!apiKey || !to) {
    console.warn(
      "[alerts] RESEND_API_KEY o ALERT_EMAIL no configurados — alerta omitida:",
      subject
    )
    return
  }

  // 3. Enviar
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => "")
      console.error(`[alerts] Resend ${res.status}: ${txt}`)
    }
  } catch (err) {
    console.error("[alerts] error enviando email:", err)
  }
}

/**
 * Detecta si un error proviene de cuota / límite excedido en Turso.
 * Los errores de libsql pueden venir con distintos formatos: chequeamos
 * texto del mensaje y posibles códigos.
 */
export function isTursoQuotaError(err: unknown): boolean {
  if (!err) return false
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  if (
    msg.includes("quota") ||
    msg.includes("over the limit") ||
    msg.includes("disabled") ||
    msg.includes("usage limit") ||
    msg.includes("plan limit") ||
    msg.includes("storage limit") ||
    msg.includes("row limit") ||
    msg.includes("monthly free") ||
    msg.includes("exceed")
  ) {
    return true
  }
  // Algunos clientes llevan un `code` o `status` numérico
  // 402 Payment Required, 429 Too Many Requests
  const anyErr = err as { code?: unknown; status?: unknown }
  if (anyErr.status === 402 || anyErr.status === 429) return true
  if (typeof anyErr.code === "string" && /quota|limit/i.test(anyErr.code)) return true
  return false
}

/** Avisa por email de que Turso está rechazando peticiones por cuota. */
export async function notifyTursoQuotaExceeded(err: unknown, context?: string): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err)
  const ts  = new Date().toISOString()
  const env = process.env.NODE_ENV ?? "unknown"

  await sendEmail({
    key:     "turso-quota",
    subject: "🚨 DGT Tests · cuota de Turso excedida",
    html: `
      <h2 style="font-family: system-ui, sans-serif;">Turso ha rechazado una petición por cuota</h2>
      <p style="font-family: system-ui, sans-serif;">
        Una llamada a la BBDD ha fallado porque parece que la cuota mensual de Turso está agotada.
        Considera ampliar el plan o esperar al reset.
      </p>
      <ul style="font-family: system-ui, sans-serif;">
        <li><b>Cuándo:</b> ${ts}</li>
        <li><b>Entorno:</b> ${env}</li>
        ${context ? `<li><b>Contexto:</b> ${context}</li>` : ""}
      </ul>
      <pre style="background: #f5f5f5; padding: 10px; border-radius: 6px; font-size: 12px; overflow: auto;">
${msg}
      </pre>
      <p style="font-family: system-ui, sans-serif; color: #888; font-size: 12px;">
        Se enviará como máximo 1 email por hora aunque el error siga ocurriendo.
      </p>
    `,
  })
}
