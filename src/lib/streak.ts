/**
 * Helpers de racha (streak) para el dashboard.
 *
 * Encapsula las 3 piezas de lógica que antes vivían dispersas en page.tsx:
 *   1. Cálculo del array `last7` (7 días, hoy a la derecha) a partir de
 *      las fechas de examen reales del usuario.
 *   2. Cálculo del `streakDays` (días consecutivos hasta hoy con al menos
 *      un examen — opcionalmente "restaurado" con crédito).
 *   3. Estado del icono (frozen si HOY no hay aún ningún examen) y de
 *      la eligibilidad para gastar un crédito de restauración.
 *
 * También expone `awardStreakCreditIfMilestone`, que se llama desde el
 * endpoint que finaliza un examen para decidir si toca subir el contador
 * de créditos del usuario.
 */

/** Tope duro de créditos de restauración acumulables por usuario. */
export const MAX_RESTORE_CREDITS = 5

/** Letras castellanas para los 7 días de la semana, indexadas por
 *  `Date#getDay()` (0=domingo, 1=lunes, ...). */
const DAY_LETTERS = ["D", "L", "M", "X", "J", "V", "S"]

const MS_PER_DAY = 86_400_000

export interface StreakDay {
  /** Letra del día (L/M/X/J/V/S/D), en la zona horaria del servidor. */
  letter:    string
  /** Nº de exámenes (válidos para stats) ese día. 0 si no hay ninguno. */
  count:     number
  /** True si este es el último elemento del array (= hoy). */
  isToday:   boolean
  /** True si ese día fue "restaurado" gastando un crédito. Solo informativo. */
  restored:  boolean
}

export interface StreakState {
  /** 7 días: índice 0 = hace 6 días, índice 6 = hoy. */
  last7:        StreakDay[]
  /** Total de exámenes en los 7 días. */
  weekTotal:    number
  /** Media diaria (weekTotal / 7). */
  dailyAvg:     number
  /** Días consecutivos hasta HOY con examen (real o restaurado). */
  streakDays:   number
  /** Pico (mín. 1) usado para escalar la barra del gráfico. */
  maxDay:       number
  /** True si la racha está "en peligro": hoy aún no hay examen real. */
  frozen:       boolean
  /** True si el botón "Restaurar racha" debe mostrarse al usuario. */
  canRestore:   boolean
}

/** Devuelve la medianoche local del Date dado (no muta el original). */
function midnight(d: Date): Date {
  const m = new Date(d)
  m.setHours(0, 0, 0, 0)
  return m
}

function sameDay(a: Date, b: Date): boolean {
  return midnight(a).getTime() === midnight(b).getTime()
}

/**
 * Construye el estado completo de la racha para el dashboard.
 *
 * @param attemptDates  Fechas (Date) de cada examen finalizado del user en
 *                       los últimos 7 días (filtrado ya por ATTEMPT_STATS_WHERE).
 *                       No hace falta que estén ordenadas.
 * @param restoredUntil Valor de `user.streakRestoredUntil` (o null).
 * @param now           "Ahora" — inyectable para tests.
 */
export function computeStreakState(
  attemptDates: Date[],
  restoredUntil: Date | null,
  now: Date,
  opts: { credits: number } = { credits: 0 }
): StreakState {
  const todayMid = midnight(now)
  const restoredMid = restoredUntil ? midnight(restoredUntil) : null

  const last7: StreakDay[] = []
  for (let i = 6; i >= 0; i--) {
    const day  = new Date(todayMid.getTime() - i * MS_PER_DAY)
    const next = new Date(day.getTime() + MS_PER_DAY)
    const count = attemptDates.filter(d => d >= day && d < next).length
    const restored =
      restoredMid !== null &&
      count === 0 &&
      day.getTime() === restoredMid.getTime()
    last7.push({
      letter:  DAY_LETTERS[day.getDay()],
      count,
      isToday: i === 0,
      restored,
    })
  }

  const weekTotal = last7.reduce((acc, d) => acc + d.count, 0)
  const dailyAvg  = weekTotal / 7
  const maxDay    = Math.max(1, ...last7.map(d => d.count))

  // Racha: días contiguos desde hoy hacia atrás con count>0 O restored.
  let streakDays = 0
  for (let i = last7.length - 1; i >= 0; i--) {
    if (last7[i].count > 0 || last7[i].restored) streakDays++
    else break
  }

  const today     = last7[6]
  const yesterday = last7[5]
  const anteayer  = last7[4]

  // Frozen: hoy aún no hay examen REAL (un día "restaurado" hoy no tiene
  // sentido, restoredUntil solo se usa para ayer; pero por defensa
  // pedimos count>0, no restored).
  const frozen = today.count === 0

  // Eligibilidad de restauración:
  //   - ayer no tiene examen REAL ni está ya restaurado
  //   - anteayer SÍ tiene examen REAL (sin contar restoredUntil)
  //   - aún hay créditos
  //   - el restoredUntil no es ya el día de ayer (no se puede
  //     re-restaurar el mismo día)
  const yesterdayDay = new Date(todayMid.getTime() - MS_PER_DAY)
  const yesterdayBroken = yesterday.count === 0 && !yesterday.restored
  const anteayerHadReal = anteayer.count > 0
  const restoredIsYesterday =
    restoredMid !== null && restoredMid.getTime() === yesterdayDay.getTime()
  const canRestore =
    yesterdayBroken &&
    anteayerHadReal &&
    opts.credits > 0 &&
    !restoredIsYesterday

  return {
    last7,
    weekTotal,
    dailyAvg,
    streakDays,
    maxDay,
    frozen,
    canRestore,
  }
}

/**
 * Devuelve la medianoche local de "ayer" relativa a `now`. Lo usa la server
 * action al setear `streakRestoredUntil`, y los tests.
 */
export function yesterdayMidnight(now: Date): Date {
  const t = midnight(now)
  return new Date(t.getTime() - MS_PER_DAY)
}

/**
 * Decide si el usuario gana un crédito de restauración tras un examen.
 *
 * Lógica: si la racha cruza un múltiplo de 7 con este examen (1→7, 7→14,
 * 14→21, ...), +1 crédito (cap MAX_RESTORE_CREDITS). En cualquier otro
 * caso devuelve los créditos sin tocar.
 *
 * El callsite ya tiene `currentCredits` desde la BBDD y los nuevos
 * `oldStreak` / `newStreak` calculados sobre los attempts antes/después
 * del POST. Esto evita ir a BBDD desde aquí.
 */
export function awardStreakCreditIfMilestone(
  oldStreak: number,
  newStreak: number,
  currentCredits: number
): number {
  if (
    newStreak > oldStreak &&
    newStreak > 0 &&
    newStreak % 7 === 0 &&
    currentCredits < MAX_RESTORE_CREDITS
  ) {
    return currentCredits + 1
  }
  return currentCredits
}

/**
 * Helper público para los callsites del API: dado el array de attemptDates
 * y opcional restoredUntil, devuelve solo `streakDays`. Útil para calcular
 * old/new streak en /api/attempts sin reconstruir todo el estado.
 */
export function computeStreakDaysOnly(
  attemptDates: Date[],
  restoredUntil: Date | null,
  now: Date
): number {
  return computeStreakState(attemptDates, restoredUntil, now).streakDays
}

export { sameDay as _sameDay, midnight as _midnight }
