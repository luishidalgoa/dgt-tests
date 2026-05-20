/**
 * Lógica de "errores recientes sin corregir":
 * Por cada pregunta, miramos la última respuesta. Si fue incorrecta, va al pool.
 * Si después aciertas la misma pregunta en otro intento, sale del pool.
 */

import { db } from "@/lib/db"

export async function getPendingErrorQuestionIds(): Promise<number[]> {
  // Por cada questionId tomamos la respuesta más reciente.
  // Si esa última respuesta es incorrecta → es un error pendiente.
  const rows = await db.$queryRaw<{ questionId: number }[]>`
    SELECT a.questionId
    FROM answers a
    INNER JOIN (
      SELECT questionId, MAX(id) as lastId
      FROM answers
      GROUP BY questionId
    ) last
      ON last.questionId = a.questionId AND last.lastId = a.id
    WHERE a.isCorrect = 0
    ORDER BY a.answeredAt DESC
  `
  return rows.map((r) => r.questionId)
}

export async function countPendingErrors(): Promise<number> {
  const ids = await getPendingErrorQuestionIds()
  return ids.length
}
