/**
 * Throttle in-memory para evitar spam en Sentry de errores sistémicos
 * que se repiten N veces (rate_limit del provider IA, misconfigured,
 * provider down, etc.) — son la MISMA condición disparándose en cada
 * request del user. Nos basta con saberlo una vez.
 *
 * Uso típico:
 *   if (shouldNotifyOnce(`ai:${provider}:rate_limit`, 30 * 60 * 1000)) {
 *     captureAppException(err, { ... })
 *   }
 *
 * Limitación conocida: Vercel arranca varios lambdas para tráfico
 * concurrente, cada uno tiene su propia memoria. Con N lambdas en
 * caliente, se podrían disparar N eventos antes de que el throttle
 * coja. En la práctica:
 *   - Tráfico bajo (~1 RPS): 1 evento por TTL ✓
 *   - Tráfico medio (~10 RPS): ~2-5 eventos por TTL (aceptable)
 *   - Tráfico alto: usar DB-backed (no implementado todavía)
 *
 * Sigue siendo MUCHÍSIMO mejor que el comportamiento sin throttle
 * (~1 evento por request fallida).
 *
 * Para tests, ver _resetThrottleForTests().
 */

const _lastNotifiedAt = new Map<string, number>()

/** TTL default si el caller no especifica. */
const DEFAULT_TTL_MS = 30 * 60 * 1000  // 30 minutos

/**
 * Devuelve true si la clave NO ha sido notificada en los últimos
 * `ttlMs` ms — y registra el ahora como último aviso. Devuelve false
 * si todavía está en cooldown.
 *
 * Esto debe ser la primera comprobación del caller antes de llamar
 * a Sentry. No es transaccional contra el reloj, así que con tráfico
 * muy paralelo en el mismo lambda podría haber 2 wins simultáneos —
 * aceptable porque el peor caso son 2 eventos en lugar de 1.
 */
export function shouldNotifyOnce(key: string, ttlMs: number = DEFAULT_TTL_MS): boolean {
  const now  = Date.now()
  const last = _lastNotifiedAt.get(key) ?? 0
  if (now - last < ttlMs) return false
  _lastNotifiedAt.set(key, now)
  return true
}

/** Solo para tests: limpia el cache del throttle. */
export function _resetThrottleForTests(): void {
  _lastNotifiedAt.clear()
}
