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
  /** Path al asset "congelado" del nivel (llama dentro de un cubo de hielo).
   *  null = ese nivel aún no tiene asset dedicado → StreakIcon hace
   *  fallback a un filtro CSS sobre el iconPath base. */
  frozenIconPath: string | null
  label: string
}

/** Tabla maestra de niveles. Ordenada ASCendente por `minXp`.
 *
 *  Los `frozenIconPath` se van rellenando a medida que se generan los
 *  assets. Mientras sean `null` la UI muestra el icono base con un
 *  filtro azul. */
export const LEVELS: ReadonlyArray<LevelDef> = [
  { level: 0, minXp: 0,    iconPath: "/streak/lvl-0.png", frozenIconPath: null,                          label: "Llama apagada" },
  { level: 1, minXp: 50,   iconPath: "/streak/lvl-1.png", frozenIconPath: "/streak/lvl-1-freeze.png",    label: "Chispa" },
  { level: 2, minXp: 150,  iconPath: "/streak/lvl-2.png", frozenIconPath: null,                          label: "Llama pequeña" },
  { level: 3, minXp: 400,  iconPath: "/streak/lvl-3.png", frozenIconPath: null,                          label: "Llama estable" },
  { level: 4, minXp: 1000, iconPath: "/streak/lvl-4.png", frozenIconPath: null,                          label: "Llama fuerte" },
  { level: 5, minXp: 2500, iconPath: "/streak/lvl-5.png", frozenIconPath: null,                          label: "Hoguera intensa" },
  { level: 6, minXp: 6000, iconPath: "/streak/lvl-6.png", frozenIconPath: null,                          label: "Fénix" },
] as const

export const MAX_LEVEL = LEVELS[LEVELS.length - 1].level

export interface LevelInfo {
  /** Nivel actual (0..MAX_LEVEL) */
  level: number
  /** Etiqueta legible para el nivel */
  label: string
  /** Ruta absoluta del PNG del icono. Lista para `<Image src={...}>`. */
  iconPath: string
  /** Ruta del asset "congelado" si existe para este nivel, null si no. */
  frozenIconPath: string | null
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
      level:          current.level,
      label:          current.label,
      iconPath:       current.iconPath,
      frozenIconPath: current.frozenIconPath,
      minXp:          current.minXp,
      nextLevelXp:    null,
      xpToNext:       0,
      progressPct:    100,
    }
  }

  const span     = next.minXp - current.minXp
  const into     = safeXp - current.minXp
  const pct      = Math.max(0, Math.min(100, Math.round((into / span) * 100)))

  return {
    level:          current.level,
    label:          current.label,
    iconPath:       current.iconPath,
    frozenIconPath: current.frozenIconPath,
    minXp:          current.minXp,
    nextLevelXp:    next.minXp,
    xpToNext:       Math.max(0, next.minXp - safeXp),
    progressPct:    pct,
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

/** Estado de la racha del usuario para mostrar en UI.
 *
 *   - "active":   hoy ya tiene ≥1 examen que cuenta para stats.
 *                 `days` = longitud incluyendo hoy.
 *   - "frozen":   hoy NO tiene examen pero ayer (o algún día más reciente)
 *                 sí. La racha está "congelada" — si juega hoy se
 *                 mantiene; si pasa otro día sin actividad se rompe.
 *                 `days` = longitud HASTA AYER.
 *   - "dormant":  ni hoy ni el día anterior cuentan. `days` = 0.
 */
export type StreakStateKind = "active" | "frozen" | "dormant"

export interface StreakState {
  state: StreakStateKind
  /** Días en la racha — incluye hoy si active, hasta ayer si frozen, 0 si dormant. */
  days: number
  /** true sii el bonus diario de racha ya se ha pagado en este día. */
  claimedToday: boolean
}

/**
 * Calcula el estado canónico de racha del usuario para la UI.
 * Una sola query a BBDD. Diseñada para llamarse desde Server Components
 * (dashboard) — no usar dentro del finish-exam (ahí ya pagamos vía
 * `awardDailyStreakBonusIfDue`).
 */
export async function getStreakState(userId: number): Promise<StreakState> {
  const user = await db.user.findUnique({
    where:  { id: userId },
    select: { lastStreakBonusAt: true },
  })

  const todayMid = new Date()
  todayMid.setHours(0, 0, 0, 0)
  const claimedToday = !!user?.lastStreakBonusAt
    && user.lastStreakBonusAt.getTime() >= todayMid.getTime()

  // Miramos 60 días atrás. Más allá no nos importa para la racha actual.
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

  // Set de días con examen, indexado por delta-en-días desde hoy
  // (0 = hoy, -1 = ayer, ...).
  const daysWithAttempt = new Set<number>()
  for (const a of attempts) {
    const dayDelta = Math.floor((a.startedAt.getTime() - todayMid.getTime()) / 86400000)
    daysWithAttempt.add(dayDelta)
  }

  if (daysWithAttempt.has(0)) {
    // ACTIVE: cuenta consecutivos desde hoy hacia atrás.
    let days = 0
    for (let d = 0; d > -365; d--) {
      if (daysWithAttempt.has(d)) days++
      else break
    }
    return { state: "active", days, claimedToday }
  }

  if (daysWithAttempt.has(-1)) {
    // FROZEN: hay racha hasta ayer pero no hoy. Cuenta desde ayer.
    let days = 0
    for (let d = -1; d > -365; d--) {
      if (daysWithAttempt.has(d)) days++
      else break
    }
    // `claimedToday` se mantiene como false-via-derivación: si HOY no
    // hay actividad, no se ha podido pagar el bonus diario hoy. (La
    // columna de BBDD podría estar a hoy si el cron de zona horaria
    // se desfasa, pero el caso es marginal y la UI seguirá siendo
    // coherente.)
    return { state: "frozen", days, claimedToday: false }
  }

  return { state: "dormant", days: 0, claimedToday: false }
}

/**
 * Si el usuario tiene racha activa hoy y aún no ha cobrado el bonus
 * diario de racha en este día, lo otorga. Devuelve el `AwardXpResult`
 * resultante o `null` si no aplicaba (ya cobrado hoy, sin racha, etc.).
 *
 * Diseñado para llamarse DESPUÉS de crear el ExamAttempt — para que la
 * query interna ya incluya el examen recién terminado y considere
 * "hoy" como día con actividad.
 */
export async function awardDailyStreakBonusIfDue(
  userId: number,
): Promise<AwardXpResult | null> {
  const status = await getStreakState(userId)
  if (status.state !== "active") return null
  if (status.claimedToday) return null

  const bonus = computeStreakDayBonus(status.days)
  if (bonus <= 0) return null

  // Marca primero la fecha (evita doble-cobro en race) y luego paga.
  await db.user.update({
    where: { id: userId },
    data:  { lastStreakBonusAt: new Date() },
  })
  return awardXp(userId, bonus, "streak-day")
}

// ── Visualización del ciclo de 7 días ──────────────────────────────────

export interface CycleSlot {
  /** Posición en el ciclo actual (1..7). */
  day: number
  /** XP que se gana ESE día de racha. */
  bonus: number
  /** El slot está completo en el ciclo actual (ya se cobró). */
  isEarned: boolean
  /** El slot representa HOY (puede ser earned-y-today al mismo tiempo
   *  cuando el bonus ya se cobró; o solo today cuando está pendiente). */
  isToday: boolean
}

/**
 * Construye la vista de 7 slots del ciclo de racha ACTUAL del usuario.
 * Función pura — toma el estado de la racha y devuelve qué se debe
 * pintar. Diseñada para ser tested sin BBDD.
 *
 *  - ACTIVE + claimedToday:  el día actual ya está dentro de `earned`,
 *                            se marca como `isToday` para destacarlo.
 *  - ACTIVE sin claim:       el día actual es pending; earned = days-1.
 *                            (No debería ocurrir tras finish-exam, pero
 *                             si la BBDD del bonus falla quedaríamos
 *                             aquí — defensivo.)
 *  - FROZEN:                 todos los `days` están earned. Hoy sería
 *                            el slot pos+1 dentro del ciclo, marcado
 *                            como pending. Si el ciclo está completo
 *                            (pos=7) no hay slot "hoy" en este ciclo.
 *  - DORMANT:                cero earned, día 1 marcado como `isToday`
 *                            (= "si juegas hoy esto es lo que ganas").
 */
export function buildCycleView(args: {
  state: StreakStateKind
  days: number
  claimedToday: boolean
}): CycleSlot[] {
  const { state, days, claimedToday } = args

  let earnedThroughDay = 0   // 0..7
  let todayDay = 0           // 0 = sin "hoy" en este ciclo, 1..7 = posición

  if (state === "active") {
    const pos = ((days - 1) % STREAK_DAY_BONUSES.length) + 1
    if (claimedToday) {
      earnedThroughDay = pos
      todayDay = pos
    } else {
      earnedThroughDay = Math.max(0, pos - 1)
      todayDay = pos
    }
  } else if (state === "frozen") {
    const pos = ((days - 1) % STREAK_DAY_BONUSES.length) + 1
    earnedThroughDay = pos
    todayDay = pos < STREAK_DAY_BONUSES.length ? pos + 1 : 0
  } else {
    // dormant
    earnedThroughDay = 0
    todayDay = 1
  }

  return STREAK_DAY_BONUSES.map((bonus, i): CycleSlot => {
    const day = i + 1
    return {
      day,
      bonus,
      isEarned: day <= earnedThroughDay,
      isToday:  day === todayDay,
    }
  })
}
