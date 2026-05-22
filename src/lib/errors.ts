/**
 * Lógica de "errores recientes sin corregir" — scoped por usuario.
 * Por cada pregunta, miramos la última respuesta del usuario. Si fue
 * incorrecta, va al pool. Si después acierta la misma pregunta en otro
 * intento, sale del pool.
 *
 * EXCEPCIÓN — modo "errores-refuerzo" (Fase 109): las respuestas dadas
 * en attempts con mode='errores-refuerzo' NO se consideran para el
 * "último estado" de la pregunta. Es decir, si el usuario practica un
 * error en modo refuerzo y lo acierta, la pregunta sigue en pendientes.
 * El propósito es alimentar al análisis IA con histórico completo sin
 * que el usuario pierda los temas débiles del pool. El intento sí
 * queda registrado en BBDD (answers + exam_attempts) para que la IA lo
 * pueda leer; simplemente no resuelve el error.
 */

import { db } from "@/lib/db"

export async function getPendingErrorQuestionIds(userId: number): Promise<number[]> {
  // El subquery interno usa solo intentos NO-refuerzo para determinar el
  // último estado; el outer JOIN luego verifica que ese último estado sea
  // un fallo. El filtro va dentro del subquery porque queremos ignorar
  // los aciertos en refuerzo, no transformarlos en error.
  const rows = await db.$queryRaw<{ questionId: number }[]>`
    SELECT a.questionId
    FROM answers a
    INNER JOIN exam_attempts ea ON ea.id = a.attemptId
    INNER JOIN (
      SELECT a2.questionId, MAX(a2.id) as lastId
      FROM answers a2
      INNER JOIN exam_attempts ea2 ON ea2.id = a2.attemptId
      WHERE ea2.userId = ${userId} AND ea2.mode != 'errores-refuerzo'
      GROUP BY a2.questionId
    ) last
      ON last.questionId = a.questionId AND last.lastId = a.id
    WHERE a.isCorrect = 0 AND ea.userId = ${userId} AND ea.mode != 'errores-refuerzo'
    ORDER BY a.answeredAt DESC
  `
  return rows.map((r) => r.questionId)
}

export async function countPendingErrors(userId: number): Promise<number> {
  const ids = await getPendingErrorQuestionIds(userId)
  return ids.length
}
