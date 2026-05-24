/**
 * Gamificación: XP + niveles.
 *
 * El usuario acumula XP al finalizar exámenes (ver `computeExamXp`) y al
 * mantener rachas (`awardWeeklyStreakBonusIfDue`). De ese contador se
 * deriva un nivel 0..6 que controla qué icono de racha se muestra en el
 * dashboard (lvl-0 = llama apagada, lvl-6 = fénix).
 *
 * Niveles y umbrales son geométricos (~2.5×) para que la progresión se
 * sienta acelerada al principio y se vuelva un objetivo a medio plazo:
 *
 *    Lvl  XP requerido   Asset
 *    ──   ────────────   ─────────────
 *     0          0       /streak/lvl-0.png   (contorno vacío)
 *     1         50       /streak/lvl-1.png   (chispa)
 *     2        150       /streak/lvl-2.png   (llama pequeña)
 *     3        400       /streak/lvl-3.png   (llama estable)
 *     4       1000       /streak/lvl-4.png   (llama fuerte)
 *     5       2500       /streak/lvl-5.png   (hoguera intensa)
 *     6       6000       /streak/lvl-6.png   (fénix)
 */

import { db } from "@/lib/db"
import { ATTEMPT_STATS_WHERE } from "@/lib/stats"

// ── Configuración de niveles ────────────────────────────────────────────

export interface LevelDef {
  level: number
  minXp: number
  iconPath: string
  label: string
}

/** Tabla maestra de niveles. Ordenada ASCendente por `minXp`. */
export const LEVELS: ReadonlyArray<LevelDef> = [
  { level: 0, minXp: 0,    iconPath: "/streak/lvl-0.png", label: "Llama apagada" },
  { level: 1, minXp: 50,   iconPath: "/streak/lvl-1.png", label: "Chispa" },
  { level: 2, minXp: 150,  iconPath: "/streak/lvl-2.png", label: "Llama pequeña" },
  { level: 3, minXp: 400,  iconPath: "/streak/lvl-3.png", label: "Llama estable" },
  { level: 4, minXp: 1000, iconPath: "/streak/lvl-4.png", label: "Llama fuerte" },
  { level: 5, minXp: 2500, iconPath: "/streak/lvl-5.png", label: "Hoguera intensa" },
  { level: 6, minXp: 6000, iconPath: "/streak/lvl-6.png", label: "Fénix" },
] as const

export const MAX_LEVEL = LEVELS[LEVELS.length - 1].level

export interface LevelInfo {
  /** Nivel actual (0..MAX_LEVEL) */
  level: number
  /** Etiqueta legible para el nivel */
  label: string
  /** Ruta absoluta del PNG del icono. Lista para `<Image src={...}>`. */
  iconPath: string
  /** Umbral de XP del nivel actual */
  minXp: number
  /** Umbral de XP del siguiente nivel. null si ya está al máximo. */
  nextLevelXp: number | null
  /** XP que falta para subir de nivel. 0 si ya está al máximo. */
  xpToNext: number
  /** Progreso al siguiente nivel en porcentaje (0..100). 100 si ya está al máximo. */
  progressPct: number
}

/**
 * Devuelve toda la info de nivel asociada a un XP dado.
 * Tolera valores fuera de rango (XP negativo → lvl 0; XP gigante → MAX_LEVEL).
 */
export function getLevel(xp: number): LevelInfo {
  const safeXp = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0

  // Encuentra el nivel actual: el último cuyo `minXp` no supera safeXp.
  let current: LevelDef = LEVELS[0]
  for (const lvl of LEVELS) {
    if (lvl.minXp <= safeXp) current = lvl
    else break
  }

  const nextIdx = current.level + 1
  const next = nextIdx < LEVELS.length ? LEVELS[nextIdx] : null

  if (!next) {
    return {
      level:       current.level,
      label:       current.label,
      iconPath:    current.iconPath,
      minXp:       current.minXp,
      nextLevelXp: null,
      xpToNext:    0,
      progressPct: 100,
    }
  }

  const span     = next.minXp - current.minXp
  const into     = safeXp - current.minXp
  const pct      = Math.max(0, Math.min(100, Math.round((into / span) * 100)))

  return {
    level:       current.level,
    label:       current.label,
    iconPath:    current.iconPath,
    minXp:       current.minXp,
    nextLevelXp: next.minXp,
    xpToNext:    Math.max(0, next.minXp - safeXp),
    progressPct: pct,
  }
}

// ── Cálculo de XP por examen ────────────────────────────────────────────

export type XpReason =
  | "exam-finish"
  | "exam-pass"
  | "exam-perfect"
  | "exam-errores"
  | "streak-7days"

export interface XpLineItem {
  reason: XpReason
  amount: number
}

/**
 * Calcula el XP a otorgar tras finalizar un intento, según modo y nota.
 *
 *   - mode in {normal, tema}:
 *       +10 siempre (haber finalizado)
 *       +20 si score ≥ 27 y total === 30  (aprobado examen DGT)
 *       +50 si score === 30 y total === 30 (perfecto)
 *   - mode in {errores, errores-refuerzo}:
 *       +5 (refuerzo de fallos)
 *
 * Devuelve el desglose para poder mostrarlo al usuario.
 */
export function computeExamXp(args: {
  mode: string
  score: number
  total: number
}): XpLineItem[] {
  const { mode, score, total } = args
  const items: XpLineItem[] = []

  if (mode === "errores" || mode === "errores-refuerzo") {
    items.push({ reason: "exam-errores", amount: 5 })
    return items
  }

  // normal / tema
  items.push({ reason: "exam-finish", amount: 10 })

  // Bonus de aprobado/perfecto solo cuando el examen es de 30 preguntas
  // (el formato oficial DGT). Tests de tema con N≠30 no aplican.
  if (total === 30) {
    if (score === 30) {
      items.push({ reason: "exam-perfect", amount: 50 })
    } else if (score >= 27) {
      items.push({ reason: "exam-pass", amount: 20 })
    }
  }

  return items
}

/** Suma total del desglose. */
export function sumXp(items: ReadonlyArray<XpLineItem>): number {
  return items.reduce((acc, i) => acc + i.amount, 0)
}

// ── Otorgar XP ──────────────────────────────────────────────────────────

export interface AwardXpResult {
  oldXp: number
  newXp: number
  oldLevel: number
  newLevel: number
  /** true sii subió al menos un nivel (puede ser más de uno si la cantidad es grande). */
  leveledUp: boolean
  /** Snapshot del nuevo nivel — listo para devolver al cliente. */
  levelInfo: LevelInfo
}

/**
 * Incrementa el XP del usuario y devuelve el cambio de nivel.
 *
 * Idempotente NO — cada llamada incrementa. La atomicidad se garantiza con
 * `xp: { increment }` (una sola sentencia SQL).
 *
 * Si `amount <= 0` devuelve un no-op con el estado actual; útil para
 * simplificar el caller sin condicionales.
 */
export async function awardXp(
  userId: number,
  amount: number,
  reason: XpReason,
): Promise<AwardXpResult> {
  if (!Number.isFinite(amount) || amount <= 0) {
    const u = await db.user.findUnique({
      where:  { id: userId },
      select: { xp: true },
    })
    const xp = u?.xp ?? 0
    const info = getLevel(xp)
    return {
      oldXp:    xp,
      newXp:    xp,
      oldLevel: info.level,
      newLevel: info.level,
      leveledUp: false,
      levelInfo: info,
    }
  }

  const updated = await db.user.update({
    where:  { id: userId },
    data:   { xp: { increment: amount } },
    select: { xp: true },
  })

  const newXp     = updated.xp
  const oldXp     = newXp - amount
  const oldLevel  = getLevel(oldXp).level
  const newInfo   = getLevel(newXp)

  // Línea de auditoría barata. Permite reconstruir el historial de XP por
  // motivo si en el futuro alguien se queja de "no me dio los puntos del
  // examen perfecto". Si se vuelve ruidoso, encapsular en process.env.
  console.info(`[xp] user=${userId} +${amount} reason=${reason} → ${newXp} XP (lvl ${newInfo.level})`)

  return {
    oldXp,
    newXp,
    oldLevel,
    newLevel:  newInfo.level,
    leveledUp: newInfo.level > oldLevel,
    levelInfo: newInfo,
  }
}

// ── Bonus por racha de 7 días ──────────────────────────────────────────

const STREAK_BONUS_AMOUNT = 30
const STREAK_BONUS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Comprueba si el usuario tiene 7+ días seguidos con al menos 1 examen
 * "que cuenta" terminado hasta hoy. Si sí y no ha cobrado este bonus en
 * los últimos 7 días, otorga +30 XP y actualiza `lastWeekStreakBonusAt`.
 *
 * Devuelve el resultado de `awardXp` si pagó, o `null` si no aplicaba.
 */
export async function awardWeeklyStreakBonusIfDue(
  userId: number,
): Promise<AwardXpResult | null> {
  const user = await db.user.findUnique({
    where:  { id: userId },
    select: { lastWeekStreakBonusAt: true },
  })
  if (!user) return null

  // ¿Ya cobró bonus dentro de la ventana de 7 días? Si sí, salir barato.
  if (user.lastWeekStreakBonusAt) {
    const sinceMs = Date.now() - user.lastWeekStreakBonusAt.getTime()
    if (sinceMs < STREAK_BONUS_WINDOW_MS) return null
  }

  // Comprueba racha real: 7 días consecutivos terminando hoy con ≥1
  // intento "que cuenta" (normal/tema, no errores).
  const hasStreak = await hasSevenDayStreak(userId)
  if (!hasStreak) return null

  // Marca primero la fecha (evita doble-cobro en race) y luego paga.
  await db.user.update({
    where: { id: userId },
    data:  { lastWeekStreakBonusAt: new Date() },
  })
  return awardXp(userId, STREAK_BONUS_AMOUNT, "streak-7days")
}

/** True si el usuario tiene ≥7 días consecutivos (incluyendo hoy) con
 *  al menos 1 attempt válido para stats. */
async function hasSevenDayStreak(userId: number): Promise<boolean> {
  const todayMid = new Date()
  todayMid.setHours(0, 0, 0, 0)
  const sevenDaysAgo = new Date(todayMid.getTime() - 6 * 86400000) // 6 días atrás + hoy = 7

  const attempts = await db.examAttempt.findMany({
    where: {
      userId,
      finishedAt: { not: null },
      startedAt:  { gte: sevenDaysAgo },
      ...ATTEMPT_STATS_WHERE,
    },
    select: { startedAt: true },
  })
  if (attempts.length === 0) return false

  // Mapa día (0..6 desde hace-6-días) → ¿hubo attempt?
  const dayHas = new Array(7).fill(false) as boolean[]
  for (const a of attempts) {
    const t = a.startedAt.getTime()
    const dayIdx = Math.floor((t - sevenDaysAgo.getTime()) / 86400000)
    if (dayIdx >= 0 && dayIdx < 7) dayHas[dayIdx] = true
  }
  return dayHas.every(Boolean)
}
