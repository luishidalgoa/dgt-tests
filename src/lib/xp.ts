/**
 * Gamificación: XP + niveles.
 *
 * Economía:
 *   - Base por examen: `max(0, round(15 - 1.5 × errores))`. Aplica a
 *     CUALQUIER modo (normal, tema, errores, errores-refuerzo). Premia
 *     la precisión por encima del simple "haber finalizado".
 *   - Bonus diario de racha (una sola vez por día, en el primer examen
 *     que cuente para stats): ciclo [5, 7, 10, 15, 20, 30, 50] indexado
 *     por la longitud actual de la racha. Día 8 vuelve a 5 (loop), día 9
 *     a 7, etc. Si rompes la racha vuelves a empezar por día 1.
 *
 * El nivel se deriva del XP acumulado vía `getLevel`. Tabla geométrica
 * 0..6:
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

export type XpReason = "exam-finish" | "streak-day"

export interface XpLineItem {
  reason: XpReason
  amount: number
}

/** Base XP por examen, antes de penalizar errores. */
export const EXAM_BASE_XP = 15
/** XP que pierde el usuario por cada error. Multiplicado por nº errores
 *  y restado de `EXAM_BASE_XP`. Se redondea al integer más cercano y se
 *  clava a 0 (no hay XP negativo). */
export const EXAM_ERROR_PENALTY = 1.5

/**
 * Calcula el XP base por finalizar un intento.
 *
 *   amount = max(0, round(15 - 1.5 × errores))
 *
 * Aplica a CUALQUIER modo. Pasar 0 errores = 15 XP, 1 = 14, 2 = 12,
 * 3 = 11, ... 10 = 0. Es la única fuente de XP por "ejercicio" — la
 * antigua tabla de +10/+20/+50 fue reemplazada por esta fórmula.
 *
 * Devuelve un único line-item para consistencia con la implementación
 * antigua y para permitir un breakdown legible en la UI.
 */
export function computeExamXp(args: {
  score: number
  total: number
}): XpLineItem[] {
  const { score, total } = args
  const errors = Math.max(0, total - score)
  const amount = Math.max(0, Math.round(EXAM_BASE_XP - EXAM_ERROR_PENALTY * errors))
  return [{ reason: "exam-finish", amount }]
}

/** Suma total del desglose. */
export function sumXp(items: ReadonlyArray<XpLineItem>): number {
  return items.reduce((acc, i) => acc + i.amount, 0)
}

// ── Bonus diario de racha ──────────────────────────────────────────────

/** Bonuses por día de racha consecutiva. Indexado por día - 1 (día 1
 *  = índice 0). Si la racha sobrepasa la tabla, vuelve al principio. */
export const STREAK_DAY_BONUSES: ReadonlyArray<number> = [5, 7, 10, 15, 20, 30, 50] as const

/**
 * Devuelve el bonus de XP que corresponde a `streakDays` (días seguidos
 * con ≥1 examen que cuenta, incluyendo hoy). El día 8 vuelve a 5 puntos,
 * el día 9 a 7, y así sucesivamente. `streakDays ≤ 0` devuelve 0.
 */
export function computeStreakDayBonus(streakDays: number): number {
  if (!Number.isFinite(streakDays) || streakDays <= 0) return 0
  const idx = (Math.floor(streakDays) - 1) % STREAK_DAY_BONUSES.length
  return STREAK_DAY_BONUSES[idx]
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

// ── Cálculo de racha + bonus diario ─────────────────────────────────────

/**
 * Devuelve la longitud de la racha actual del usuario en días: cuántos
 * días consecutivos hasta hoy (inclusive) tiene al menos 1 examen que
 * cuente para stats (mode normal/tema, ver `ATTEMPT_STATS_WHERE`).
 *
 * Si hoy NO tiene ningún examen, devuelve 0. Si tiene ≥1 hoy pero ayer
 * no, devuelve 1. Etc.
 */
export async function getCurrentStreakLength(userId: number): Promise<number> {
  const todayMid = new Date()
  todayMid.setHours(0, 0, 0, 0)
  // Miramos 60 días atrás como margen. La racha de un usuario activo
  // será mucho menor, y si supera los 60 días seguidos haciendo tests
  // pues ya es campeón.
  const lookback = new Date(todayMid.getTime() - 60 * 86400000)

  const attempts = await db.examAttempt.findMany({
    where: {
      userId,
      finishedAt: { not: null },
      startedAt:  { gte: lookback },
      ...ATTEMPT_STATS_WHERE,
    },
    select: { startedAt: true },
  })
  if (attempts.length === 0) return 0

  // Set de días "tiene examen", representado como delta en días desde
  // medianoche de hoy (0 = hoy, -1 = ayer, -2 = anteayer, ...).
  const daysWithAttempt = new Set<number>()
  for (const a of attempts) {
    const dayDelta = Math.floor((a.startedAt.getTime() - todayMid.getTime()) / 86400000)
    daysWithAttempt.add(dayDelta)
  }

  // Cuenta consecutivos retrocediendo desde hoy.
  let streak = 0
  for (let d = 0; d > -365; d--) {
    if (daysWithAttempt.has(d)) streak++
    else break
  }
  return streak
}

/**
 * Si el usuario tiene racha activa hoy y aún no ha cobrado el bonus
 * diario de racha en este día, lo otorga. Devuelve el `AwardXpResult`
 * resultante o `null` si no aplicaba (ya cobrado hoy, sin racha, etc.).
 *
 * Diseñado para llamarse DESPUÉS de crear el ExamAttempt — para que la
 * query de `getCurrentStreakLength` ya incluya el examen recién
 * terminado y considere "hoy" como día con actividad.
 */
export async function awardDailyStreakBonusIfDue(
  userId: number,
): Promise<AwardXpResult | null> {
  const user = await db.user.findUnique({
    where:  { id: userId },
    select: { lastStreakBonusAt: true },
  })
  if (!user) return null

  const todayMid = new Date()
  todayMid.setHours(0, 0, 0, 0)

  // ¿Ya cobró bonus HOY? Comparar contra medianoche local.
  if (user.lastStreakBonusAt && user.lastStreakBonusAt.getTime() >= todayMid.getTime()) {
    return null
  }

  const streak = await getCurrentStreakLength(userId)
  if (streak <= 0) return null

  const bonus = computeStreakDayBonus(streak)
  if (bonus <= 0) return null

  // Marca primero la fecha (evita doble-cobro en race) y luego paga.
  await db.user.update({
    where: { id: userId },
    data:  { lastStreakBonusAt: new Date() },
  })
  return awardXp(userId, bonus, "streak-day")
}
