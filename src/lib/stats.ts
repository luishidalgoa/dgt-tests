/**
 * Helpers de filtros Prisma para distinguir qué attempts cuentan en
 * estadísticas (% aciertos, racha, totales) y qué no.
 *
 * Reglas vigentes:
 *   - mode="normal":  test oficial del temario          → CUENTA
 *   - mode="tema":    práctica desde /temas/X[/Y]       → CUENTA
 *   - mode="errores": práctica desde /test-errores      → NO CUENTA
 *
 * Aplicado en:
 *   - src/app/page.tsx       (dashboard)
 *   - src/app/stats/page.tsx (panel de stats)
 *
 * NO aplicado en:
 *   - src/app/historial/page.tsx     (muestra TODO lo que has hecho)
 *   - cálculo de "errores pendientes" (sí mira la última respuesta de
 *     cualquier modo, incluyendo /test-errores)
 *
 * Si en el futuro hay un modo más que no debe contar (p.ej. "manual"
 * para preguntas leídas en el flipbook), solo hay que añadirlo aquí
 * y se aplica automáticamente en todos los puntos de stats.
 */

/**
 * WHERE-fragment Prisma para queries directas sobre ExamAttempt que
 * deben contar como "estadísticas reales".
 *
 *   db.examAttempt.count({
 *     where: { userId, ...ATTEMPT_STATS_WHERE }
 *   })
 *
 * Hoy solo excluimos mode="errores" (/test-errores). Si en el futuro
 * se añaden más modos no-stats (p.ej. "manual"), cambiar a `notIn`.
 */
export const ATTEMPT_STATS_WHERE = {
  mode: { not: "errores" },
}

/**
 * Fragmento de WHERE para queries SQL raw (cuando no podemos usar Prisma).
 * El alias `ea` debe ser el del JOIN sobre exam_attempts.
 *
 *   `... LEFT JOIN exam_attempts ea ON ea.id = a.attemptId ${SQL_ATTEMPT_STATS_AND}`
 */
export const SQL_ATTEMPT_STATS_AND = `AND ea.mode != 'errores'`
