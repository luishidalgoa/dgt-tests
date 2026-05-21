/**
 * Persistencia del examen en curso en localStorage.
 *
 * - Solo guardamos UN examen (el último que se estaba haciendo). Al empezar
 *   un examen distinto, sobrescribimos.
 * - Solo persistimos exámenes con un test concreto (test.id > 0 y
 *   testNumber > 0). Los tests aleatorios de /temas o /test-errores no son
 *   reanudables.
 * - El timer se reanuda calculando el tiempo transcurrido desde startedAt.
 */

export const EXAM_STATE_KEY = "dgt:current-exam"

export interface SavedExamState {
  /** "/permiso-b" + slug */
  categorySlug:   string
  /** Nombre legible (para mostrar en dashboard) */
  categoryName:   string
  /** Código corto (ej. "134") */
  categoryCode:   string
  testId:         number
  testNumber:     number
  /** "practica" | "examen" — para reconstruir la URL */
  mode:           "practica" | "examen"
  /** Mapa pregunta → opción seleccionada */
  answers:        Record<number, number | null>
  /** Pregunta en la que estaba el usuario */
  current:        number
  /** ISO timestamp del primer guardado */
  startedAt:      string
  /** Duración del temporizador en segundos (null = sin tiempo) */
  timeLimit:      number | null
  /** Para mostrar X/total en el dashboard */
  totalQuestions: number
}

function isBrowser(): boolean {
  return typeof window !== "undefined"
}

export function loadExamState(): SavedExamState | null {
  if (!isBrowser()) return null
  try {
    const raw = window.localStorage.getItem(EXAM_STATE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as SavedExamState
  } catch {
    return null
  }
}

export function saveExamState(state: SavedExamState): void {
  if (!isBrowser()) return
  try {
    window.localStorage.setItem(EXAM_STATE_KEY, JSON.stringify(state))
  } catch {
    // Silencioso (quota llena, modo privado, etc.)
  }
}

export function clearExamState(): void {
  if (!isBrowser()) return
  try {
    window.localStorage.removeItem(EXAM_STATE_KEY)
  } catch {
    // ignore
  }
}

/** Reconstruye la URL para reanudar un examen guardado. */
export function resumeUrl(state: SavedExamState): string {
  return `/${state.categorySlug}/${state.testNumber}?mode=${state.mode}`
}

/** Cuenta cuántas preguntas tienen respuesta (no null). */
export function countAnswered(state: SavedExamState): number {
  return Object.values(state.answers).filter((v) => v !== null).length
}

/**
 * Si hay tiempo límite, calcula los segundos restantes basados en startedAt.
 * Devuelve null si no hay temporizador. Negativos se clavan a 0.
 */
export function remainingSeconds(state: SavedExamState): number | null {
  if (state.timeLimit === null || state.timeLimit === undefined) return null
  const elapsed = (Date.now() - new Date(state.startedAt).getTime()) / 1000
  return Math.max(0, state.timeLimit - Math.floor(elapsed))
}
