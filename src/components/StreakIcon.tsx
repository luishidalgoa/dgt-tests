import Image from "next/image"
import { getLevel } from "@/lib/xp"

/**
 * Estado visual del icono:
 *   - "active":   racha viva (mostrar el icono del nivel a color)
 *   - "frozen":   tenía racha pero hoy aún no se ha hecho nada — la
 *                 mostraremos congelada (tinte azul / hielo). El task
 *                 paralelo "Restaurar racha rota + fuego congelado"
 *                 conectará la lógica de cuándo aplicar este estado;
 *                 aquí solo dejamos el hook visual listo.
 *   - "dormant":  el usuario no tiene racha (siempre lvl-0).
 *
 * Por defecto = "active". Renderiza el PNG correspondiente al nivel
 * derivado de `xp`. Si el PNG aún no existe (estamos generando los
 * assets), Next/Image mostrará un 404 silencioso; añadimos un `alt`
 * descriptivo para que la UI siga siendo accesible.
 */
export type StreakIconState = "active" | "frozen" | "dormant"

interface StreakIconProps {
  /** XP del usuario. De aquí se deriva el nivel y por tanto el icono. */
  xp: number
  /** Lado en píxeles (cuadrado). Default 36. */
  size?: number
  /** Estado visual. Default "active". Ver doc del tipo. */
  state?: StreakIconState
  /** Clase CSS adicional para envolver el contenedor. */
  className?: string
}

export function StreakIcon({
  xp,
  size = 36,
  state = "active",
  className,
}: StreakIconProps) {
  // En estado "dormant" siempre mostramos lvl-0 independientemente del XP
  // — visualmente el usuario está "sin racha activa".
  const effectiveXp = state === "dormant" ? 0 : xp
  const info        = getLevel(effectiveXp)

  // Estado "frozen": tinte azul + saturación baja. Cuando la otra tarea
  // implemente el sistema de racha real, podrá pasar state="frozen" sin
  // tocar este componente.
  const filter =
    state === "frozen"
      ? "saturate(0.4) hue-rotate(180deg) brightness(0.95)"
      : undefined

  return (
    <span
      className={className}
      style={{
        display:      "inline-flex",
        alignItems:   "center",
        justifyContent: "center",
        width:        size,
        height:       size,
        filter,
        transition:   "filter 200ms ease",
      }}
      title={`Nivel ${info.level} · ${info.label}`}
      aria-label={`Icono de racha — nivel ${info.level} (${info.label})`}
    >
      <Image
        src={info.iconPath}
        alt=""
        width={size}
        height={size}
        priority={false}
        unoptimized
      />
    </span>
  )
}
