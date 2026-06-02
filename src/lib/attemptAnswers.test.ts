import { describe, it, expect } from "vitest"
import {
  buildValidatedAnswerRows,
  type IncomingAnswer,
} from "./attemptAnswers"

// Escenario base: preguntas 1,2,3 existen; opciones 10..16 existen.
// Correctas: q1→10, q2→12, q3→14.
const VALID_Q = new Set([1, 2, 3])
const VALID_O = new Set([10, 11, 12, 13, 14, 15, 16])
const CORRECT = new Map<number, number>([
  [1, 10],
  [2, 12],
  [3, 14],
])

function run(answers: IncomingAnswer[]) {
  return buildValidatedAnswerRows({
    answers,
    validQuestionIds:  VALID_Q,
    validOptionIds:    VALID_O,
    correctByQuestion: CORRECT,
  })
}

describe("buildValidatedAnswerRows — caso normal", () => {
  it("puntúa aciertos y fallos sin descartar nada", () => {
    const r = run([
      { questionId: 1, selectedOptionId: 10 }, // acierto
      { questionId: 2, selectedOptionId: 11 }, // fallo
      { questionId: 3, selectedOptionId: null }, // sin contestar
    ])
    expect(r.rows).toHaveLength(3)
    expect(r.score).toBe(1)
    expect(r.droppedQuestions).toBe(0)
    expect(r.droppedOptions).toBe(0)
    expect(r.rows.map((x) => x.isCorrect)).toEqual([true, false, false])
  })
})

describe("buildValidatedAnswerRows — pregunta inexistente", () => {
  it("descarta la respuesta entera y la cuenta", () => {
    const r = run([
      { questionId: 1, selectedOptionId: 10 },  // ok
      { questionId: 99, selectedOptionId: 10 }, // pregunta borrada
    ])
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].questionId).toBe(1)
    expect(r.droppedQuestions).toBe(1)
    expect(r.score).toBe(1)
  })

  it("si TODAS las preguntas faltan, rows queda vacío", () => {
    const r = run([
      { questionId: 98, selectedOptionId: 10 },
      { questionId: 99, selectedOptionId: null },
    ])
    expect(r.rows).toHaveLength(0)
    expect(r.droppedQuestions).toBe(2)
    expect(r.score).toBe(0)
  })
})

describe("buildValidatedAnswerRows — opción inexistente", () => {
  it("anula selectedOptionId a null y lo cuenta como fallo (no rompe FK)", () => {
    const r = run([
      { questionId: 1, selectedOptionId: 999 }, // opción borrada
    ])
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].selectedOptionId).toBeNull()
    expect(r.rows[0].isCorrect).toBe(false)
    expect(r.droppedOptions).toBe(1)
    expect(r.score).toBe(0)
  })

  it("una opción inexistente que ERA la correcta no suma acierto", () => {
    // q2 correcta = 12, pero el usuario marcó 12 y la opción 12 fue
    // borrada del banco → se anula → no cuenta como acierto.
    const validOmit12 = new Set([10, 11, 13, 14, 15, 16])
    const r = buildValidatedAnswerRows({
      answers: [{ questionId: 2, selectedOptionId: 12 }],
      validQuestionIds:  VALID_Q,
      validOptionIds:    validOmit12,
      correctByQuestion: CORRECT,
    })
    expect(r.rows[0].selectedOptionId).toBeNull()
    expect(r.rows[0].isCorrect).toBe(false)
    expect(r.droppedOptions).toBe(1)
  })
})

describe("buildValidatedAnswerRows — mezcla", () => {
  it("combina descartes de preguntas y opciones", () => {
    const r = run([
      { questionId: 1, selectedOptionId: 10 },   // acierto
      { questionId: 2, selectedOptionId: 999 },  // opción borrada → null, fallo
      { questionId: 50, selectedOptionId: 10 },  // pregunta borrada → descartada
      { questionId: 3, selectedOptionId: 14 },   // acierto
    ])
    expect(r.rows).toHaveLength(3)
    expect(r.score).toBe(2)
    expect(r.droppedQuestions).toBe(1)
    expect(r.droppedOptions).toBe(1)
  })
})
