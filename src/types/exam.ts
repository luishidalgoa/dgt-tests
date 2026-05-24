/** Tipos compartidos entre cliente y servidor para el flujo de examen */

export interface OptionData {
  id: number
  letra: string
  texto: string
}

export interface QuestionData {
  id: number
  externalId: string
  enunciado: string
  imagen: string | null
  codigoTema: string | null
  options: OptionData[]
  /** Solo viene del servidor cuando el usuario es invitado (corrección en cliente) */
  correctOptionId?: number | null
  /** Solo viene del servidor cuando el usuario es invitado */
  explicacion?: string | null
  /** true si esta pregunta fue generada por IA (mostrar badge en UI) */
  aiGenerated?: boolean
}

export interface TestRunnerData {
  test: {
    id: number
    testNumber: number
    totalQuestions: number
    category: {
      slug: string
      name: string
      code: string
    }
  }
  questions: QuestionData[]
}

/**
 * Modo del intento (ExamAttempt.mode):
 *  - "normal":            test oficial del temario (cuenta para racha + % aciertos)
 *  - "tema":              práctica desde /temas/X o /temas/X/Y (sí cuenta)
 *  - "errores":           práctica desde /test-errores en modo PRÁCTICA. NO cuenta
 *                         para stats. Acertar una pregunta la saca del pool de
 *                         errores pendientes (comportamiento "limpiar fallos").
 *  - "errores-refuerzo":  práctica desde /test-errores en modo REFUERZO IA. NO
 *                         cuenta para stats Y los intentos NO actualizan el
 *                         "último estado" de la pregunta — los fallos siguen
 *                         pendientes aunque los aciertes hoy. Las respuestas
 *                         se guardan igual en BBDD: la idea es alimentar al
 *                         análisis IA con histórico completo sin que el usuario
 *                         pierda visibilidad de sus puntos débiles.
 *
 * Ambos modos "errores*" usan la misma UI (modo práctica del ExamRunner: sin
 * temporizador, con feedback inline) — la única diferencia es la semántica
 * en BBDD al persistir.
 */
export type AttemptMode = "normal" | "errores" | "errores-refuerzo" | "tema"

/** Payload para finalizar un intento */
export interface SubmitAttemptPayload {
  testId: number | null
  mode: AttemptMode
  answers: {
    questionId: number
    selectedOptionId: number | null
  }[]
}

/** Recompensa de XP devuelta tras finalizar un intento. Permite al cliente
 *  mostrar el toast de level-up sin tener que volver a llamar al servidor. */
export interface AttemptXpReward {
  /** Total de XP otorgado en este intento (suma del breakdown). */
  awarded: number
  /** Desglose por motivo. Útil si en el futuro queremos enseñar
   *  "10 + 20 (aprobado) + 50 (perfecto)". */
  breakdown: { reason: string; amount: number }[]
  /** true sii este intento hizo subir al menos un nivel. */
  leveledUp: boolean
  /** Nivel nuevo (igual al antiguo si no hubo level-up). */
  newLevel: number
  /** Nivel viejo (anterior al intento). */
  oldLevel: number
  /** Path del icono del nivel NUEVO — listo para mostrar en el toast. */
  iconPath: string
  /** Etiqueta legible del nivel nuevo, p.ej. "Llama estable". */
  levelLabel: string
}

export interface SubmitAttemptResponse {
  attemptId: number
  score: number
  total: number
  redirectUrl: string
  xp: AttemptXpReward
}
