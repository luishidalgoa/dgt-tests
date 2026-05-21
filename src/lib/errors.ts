/**
 * Lógica de "errores recientes sin corregir" — scoped por usuario.
 * Por cada pregunta, miramos la última respuesta del usuario. Si fue
 * incorrecta, va al pool. Si después acierta la misma pregunta en otro
 * intento, sale del pool.
 */

import { db } from "@/lib/db"

export async function getPendingErrorQuestionIds(userId: number): Promise<number[]> {
  const rows = await db.$queryRaw<{ questionId: number }[]>`
    SELECT a.questionId
    FROM answers a
    INNER JOIN exam_attempts ea ON ea.id = a.attemptId
    INNER JOIN (
      SELECT a2.questionId, MAX(a2.id) as lastId
      FROM answers a2
      INNER JOIN exam_attempts ea2 ON ea2.id = a2.attemptId
      WHERE ea2.userId = ${userId}
      GROUP BY a2.questionId
    ) last
      ON last.questionId = a.questionId AND last.lastId = a.id
    WHERE a.isCorrect = 0 AND ea.userId = ${userId}
    ORDER BY a.answeredAt DESC
  `
  return rows.map((r) => r.questionId)
}

export async function countPendingErrors(userId: number): Promise<number> {
  const ids = await getPendingErrorQuestionIds(userId)
  return ids.length
}
