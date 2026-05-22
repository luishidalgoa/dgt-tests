import { randomBytes, randomUUID } from "node:crypto"
import { db } from "@/lib/db"
import { QUESTION_VISIBLE_WHERE } from "@/lib/questions"

export const MAX_PLAYERS_PER_PARTY = 4
export const PARTY_COOKIE_PREFIX   = "party_token_"

/** Tipos compartidos cliente/servidor */
export interface PartyState {
  code:            string
  status:          "waiting" | "playing" | "finished"
  hostUserId:      number
  hostName:        string
  totalQuestions:  number
  categoryName:    string | null
  startedAt:       string | null
  finishedAt:      string | null
  players:         PartyPlayerState[]
}

export interface PartyPlayerState {
  id:              number
  name:            string             // username o guestName
  isGuest:         boolean
  isYou:           boolean
  isHost:          boolean
  joinedAt:        string
  answeredCount:   number             // cuántas preguntas ha respondido
  isFinished:      boolean
  score:           number             // puntos acumulados
  correctCount:    number
}

/**
 * Genera un código corto, fácil de leer, único en la tabla parties.
 * 6 caracteres, sin caracteres ambiguos (0/O, 1/I/L).
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
export async function generateUniquePartyCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const bytes = randomBytes(6)
    let code = ""
    for (let i = 0; i < 6; i++) {
      code += ALPHABET[bytes[i] % ALPHABET.length]
    }
    const existing = await db.party.findUnique({ where: { code } })
    if (!existing) return code
  }
  throw new Error("No se pudo generar un código único tras 8 intentos")
}

/** Token para identificar a un guest entre requests */
export function newGuestToken(): string {
  return randomUUID()
}

/**
 * Scoring: solo puntúan las respuestas CORRECTAS.
 *
 *   - Acierto base:          100 pts
 *   - Bonus por velocidad:   hasta +15% sobre la base (= 15 pts)
 *     · Decrece linealmente desde 15 pts (al responder en 0s) hasta 0 pts
 *       (al responder en SPEED_BONUS_WINDOW_MS o más tarde).
 *   - Fallo o respuesta en blanco: 0 pts (la velocidad NO da nada).
 *
 * Ejemplos:
 *   correct + 0  s  → 115
 *   correct + 5  s  → 110
 *   correct + 10 s  → 105
 *   correct + 15 s+ → 100
 *   wrong / blank   → 0
 */
export const SCORE_BASE_CORRECT       = 100
export const SCORE_SPEED_BONUS_PCT    = 0.15            // +15 % máximo
export const SCORE_SPEED_WINDOW_MS    = 15_000          // bonus 0 a partir de 15 s

export function scoreForAnswer(isCorrect: boolean, timeMs: number): number {
  if (!isCorrect) return 0
  // Factor lineal: 1 al instante, 0 al alcanzar SCORE_SPEED_WINDOW_MS
  const factor = Math.max(0, Math.min(1, 1 - timeMs / SCORE_SPEED_WINDOW_MS))
  const bonus  = SCORE_BASE_CORRECT * SCORE_SPEED_BONUS_PCT * factor
  return Math.round(SCORE_BASE_CORRECT + bonus)
}

/**
 * Devuelve una selección aleatoria de N question.id de una categoría
 * (o de todo el banco si no se pasa categoría).
 *
 * @param onlyTier · si se pasa, restringe a preguntas de ese tier.
 *   Usado para limitar a usuarios FREE a preguntas tier=FREE.
 *   Si es undefined, no filtra por tier (PRO/admin).
 */
export async function pickRandomQuestionIds(
  count: number,
  categoryId: number | null,
  onlyTier?: "FREE" | "PRO"
): Promise<number[]> {
  // Limitar count
  const n = Math.max(5, Math.min(60, count))

  // Inicializamos con el filtro de visibilidad (excluye preguntas IA
  // sin aprobar). Ver src/lib/questions.ts.
  const where: Record<string, unknown> = { ...QUESTION_VISIBLE_WHERE }
  if (categoryId) {
    where.testQuestions = { some: { test: { categoryId } } }
  }
  if (onlyTier) {
    where.tier = onlyTier
  }

  const candidates = await db.question.findMany({
    where,
    select: { id: true },
  })

  if (candidates.length === 0) {
    const reason = onlyTier === "FREE"
      ? "No hay preguntas gratuitas para esa categoría — suscríbete a PRO para acceder."
      : "Sin preguntas disponibles para esa categoría"
    throw new Error(reason)
  }

  // Shuffle de Fisher-Yates y tomar los primeros n
  const ids = candidates.map((q) => q.id)
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
  }
  return ids.slice(0, n)
}

/**
 * Comprueba si una party (lista de question ids) contiene alguna pregunta
 * tier=PRO. Útil para decidir si un usuario FREE puede unirse.
 */
export async function partyHasProQuestions(questionIds: number[]): Promise<boolean> {
  if (questionIds.length === 0) return false
  const hit = await db.question.findFirst({
    where:  { id: { in: questionIds }, tier: "PRO" },
    select: { id: true },
  })
  return !!hit
}
