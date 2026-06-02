/**
 * Construcción y VALIDACIÓN de las respuestas de un intento antes de
 * persistirlas.
 *
 * Motivación (issue DGT-TESTS-B): un examen puede reanudarse desde
 * localStorage horas después de cargarse. Entre medias, una pregunta —o
 * una opción— puede haberse borrado o regenerado (típico con preguntas
 * IA). Si insertamos una `Answer` cuyo `questionId` / `selectedOptionId`
 * ya no existe, SQLite revienta con "FOREIGN KEY constraint failed" y el
 * POST /api/attempts devuelve un 500.
 *
 * Este helper filtra esos casos de forma pura (sin BBDD) para que el
 * endpoint sea un wrapper fino y testeable:
 *   - Respuesta a una pregunta inexistente  → se descarta entera.
 *   - selectedOptionId inexistente           → se anula a null (cuenta
 *     como "sin contestar": ni acierta ni viola la FK).
 */

export interface IncomingAnswer {
  questionId:       number
  selectedOptionId: number | null
}

export interface BuiltAnswerRow {
  questionId:       number
  selectedOptionId: number | null
  isCorrect:        boolean
}

export interface BuildAnswersResult {
  /** Filas listas para `answer.createMany` (solo FKs válidas). */
  rows:             BuiltAnswerRow[]
  /** Aciertos entre las filas válidas. */
  score:            number
  /** Cuántas respuestas se descartaron por pregunta inexistente. */
  droppedQuestions: number
  /** Cuántas opciones seleccionadas se anularon por no existir. */
  droppedOptions:   number
}

/**
 * Filtra y puntúa las respuestas entrantes contra los conjuntos de IDs que
 * SÍ existen en BBDD.
 *
 * @param answers            respuestas tal cual llegan del cliente.
 * @param validQuestionIds   ids de preguntas que existen.
 * @param validOptionIds     ids de opciones que existen (las usadas como
 *                           `selectedOptionId`).
 * @param correctByQuestion  questionId → id de la opción correcta.
 */
export function buildValidatedAnswerRows(args: {
  answers:           ReadonlyArray<IncomingAnswer>
  validQuestionIds:  ReadonlySet<number>
  validOptionIds:    ReadonlySet<number>
  correctByQuestion: ReadonlyMap<number, number>
}): BuildAnswersResult {
  const { answers, validQuestionIds, validOptionIds, correctByQuestion } = args

  const rows: BuiltAnswerRow[] = []
  let score = 0
  let droppedQuestions = 0
  let droppedOptions = 0

  for (const a of answers) {
    // Pregunta borrada/regenerada → no se puede guardar esta respuesta.
    if (!validQuestionIds.has(a.questionId)) {
      droppedQuestions++
      continue
    }
    // Opción seleccionada que ya no existe → la tratamos como "sin
    // contestar" (null): no suma acierto pero no viola la FK.
    let selectedOptionId = a.selectedOptionId
    if (selectedOptionId !== null && !validOptionIds.has(selectedOptionId)) {
      selectedOptionId = null
      droppedOptions++
    }
    const correctOptId = correctByQuestion.get(a.questionId)
    const isCorrect = selectedOptionId !== null && correctOptId === selectedOptionId
    if (isCorrect) score++
    rows.push({ questionId: a.questionId, selectedOptionId, isCorrect })
  }

  return { rows, score, droppedQuestions, droppedOptions }
}
