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

/** Payload para finalizar un intento */
export interface SubmitAttemptPayload {
  testId: number | null
  mode: "normal" | "errores"
  answers: {
    questionId: number
    selectedOptionId: number | null
  }[]
}

export interface SubmitAttemptResponse {
  attemptId: number
  score: number
  total: number
  redirectUrl: string
}
