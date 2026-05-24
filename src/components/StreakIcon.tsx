import { Snowflake } from "lucide-react"

/**
 * Icono de la racha — emoji ahora, PNG mañana.
 *
 * Coordinado con el task "Sistema XP/niveles + evolución emoji racha":
 * cuando ese task aterriza, este componente cambia el `getEmoji()` por
 * un <img src={`/streak/${level}.png`} />. La interfaz queda igual
 * (level + frozen), así el cambio es local.
 *
 *   - frozen=true   → la racha está "en peligro": hoy todavía no hay
 *                     examen. Renderiza un copo de nieve (Snowflake de
 *                     lucide) con tonos azulados.
 *   - frozen=false  → racha activa hoy. Renderiza el 🔥 (o, en el
 *                     futuro, el PNG correspondiente al nivel).
 *
 * El `aria-label` viene del padre — este componente solo decide qué
 * pintar, no qué decir.
 */
interface Props {
  /** Nivel de XP del usuario. Por ahora 0 (no implementado). El
   *  hook está aquí para cuando aterrice el otro task. */
  level?:    number
  frozen:    boolean
  /** Tamaño del icono en px (lado). Default 22 — encaja con el .fire
   *  histórico del dashboard. */
  size?:     number
  /** Aria label opcional. Si no se pasa, el icono va aria-hidden. */
  ariaLabel?: string
}

export function StreakIcon({ level = 0, frozen, size = 22, ariaLabel }: Props) {
  // PNG path para el futuro:
  //   const src = `/streak/level-${level}${frozen ? "-frozen" : ""}.png`
  //   return <Image src={src} alt={ariaLabel ?? ""} width={size} height={size} />
  // Por ahora, fallback a emoji / icono lucide. Ignoramos `level` deliberadamente
  // hasta que el otro task lo necesite — no queremos romper la prop interface
  // sólo para silenciar el warning.
  void level

  if (frozen) {
    return (
      <span
        role={ariaLabel ? "img" : undefined}
        aria-label={ariaLabel}
        aria-hidden={ariaLabel ? undefined : true}
        title={ariaLabel}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          color: "#7dd3fc",       // sky-300
          filter: "drop-shadow(0 0 4px rgba(125, 211, 252, 0.4))",
        }}
      >
        <Snowflake
          width={size}
          height={size}
          strokeWidth={2.5}
          aria-hidden="true"
        />
      </span>
    )
  }

  // Estado activo: fire emoji estándar. Se mantiene como unicode por
  // ahora; cuando aterrice el PNG asset por nivel, se sustituye aquí.
  return (
    <span
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      title={ariaLabel}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        fontSize: Math.round(size * 0.9),
        lineHeight: 1,
      }}
    >
      🔥
    </span>
  )
}
