/**
 * Datos PUROS de niveles XP (sin imports de db / server-only).
 *
 * Por qué separado de xp.ts: xp.ts contiene `awardXp` y otras funciones
 * que tocan Prisma — al importarlas en un Client Component (p.ej. desde
 * StreakIcon o StreakDebugPanel), Next intenta empaquetar `nodemailer`
 * + `child_process` y rompe el build.
 *
 * Aquí vive solo lo que un client puede usar:
 *   - LEVELS, MAX_LEVEL, LevelDef
 *   - getLevel(xp), LevelInfo
 *
 * El resto de xp.ts re-exporta estos para que el código existente no
 * necesite cambiar imports.
 */

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
  // Nota sobre el naming: los niveles 1 y 2 mantienen el prefijo legacy
  // `lvl-` porque sus PNGs son los originales (no se regeneraron en la
  // tanda nueva). Los niveles 0, 3-6 ya usan el prefijo nuevo `level-`.
  // Todos los niveles 1-6 tienen ahora variante freeze; solo el nivel 0
  // (llama apagada) se queda sin freeze porque su icono base ya transmite
  // "inactivo" por sí solo y un filtro azul lo destrozaría visualmente.
  { level: 0, minXp: 0,    iconPath: "/streak/level-0.png", frozenIconPath: null,                            label: "Llama apagada" },
  { level: 1, minXp: 50,   iconPath: "/streak/lvl-1.png",   frozenIconPath: "/streak/lvl-1-freeze.png",      label: "Chispa" },
  { level: 2, minXp: 150,  iconPath: "/streak/lvl-2.png",   frozenIconPath: "/streak/level-2-freeze.png",    label: "Llama pequeña" },
  { level: 3, minXp: 400,  iconPath: "/streak/level-3.png", frozenIconPath: "/streak/level-3-freeze.png",    label: "Llama estable" },
  { level: 4, minXp: 1000, iconPath: "/streak/level-4.png", frozenIconPath: "/streak/level-4-freeze.png",    label: "Llama fuerte" },
  { level: 5, minXp: 2500, iconPath: "/streak/level-5.png", frozenIconPath: "/streak/level-5-freeze.png",    label: "Hoguera intensa" },
  { level: 6, minXp: 6000, iconPath: "/streak/level-6.png", frozenIconPath: "/streak/level-6-freeze.png",    label: "Fénix" },
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

  const span = next.minXp - current.minXp
  const into = safeXp - current.minXp
  const pct  = Math.max(0, Math.min(100, Math.round((into / span) * 100)))

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
