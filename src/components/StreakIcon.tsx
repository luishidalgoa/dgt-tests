import Image from "next/image"
import { getLevel } from "@/lib/xp"

/**
 * Estado visual del icono:
 *   - "active":   racha viva (mostrar el icono del nivel a color).
 *   - "frozen":   tenía racha pero hoy aún no se ha hecho nada — se
 *                 renderiza el asset "congelado" (lvl-N-freeze.png) si
 *                 existe, o se aplica un filtro CSS azul como fallback.
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
  /** Aria-label override. Si no se pasa, se genera uno descriptivo a
   *  partir del nivel y el estado. */
  ariaLabel?: string
}

export function StreakIcon({
  xp,
  size = 36,
  state = "active",
  className,
  ariaLabel,
}: StreakIconProps) {
  // En estado "dormant" siempre mostramos lvl-0 independientemente del XP
  // — visualmente el usuario está "sin racha activa".
  const effectiveXp = state === "dormant" ? 0 : xp
  const info        = getLevel(effectiveXp)

  // Estado "frozen": preferimos el asset dedicado (lvl-N-freeze.png) si
  // existe para este nivel. Si aún no se ha generado lo simulamos con
  // un filtro CSS azul sobre el icono base — así la UI sigue funcionando
  // mientras los assets se van añadiendo.
  const useFrozenAsset = state === "frozen" && info.frozenIconPath !== null
  const iconSrc = useFrozenAsset ? info.frozenIconPath! : info.iconPath
  const filter =
    state === "frozen" && !useFrozenAsset
      ? "saturate(0.4) hue-rotate(180deg) brightness(0.95)"
      : undefined

  const stateLabel =
    state === "frozen"  ? " (congelada)" :
    state === "dormant" ? " (apagada)"   : ""
  const computedLabel = `Icono de racha — nivel ${info.level} (${info.label})${stateLabel}`

  return (
    <span
      className={className}
      style={{
        display:        "inline-flex",
        alignItems:     "center",
        justifyContent: "center",
        width:          size,
        height:         size,
        filter,
        transition:     "filter 200ms ease",
      }}
      title={`Nivel ${info.level} · ${info.label}${stateLabel}`}
      aria-label={ariaLabel ?? computedLabel}
    >
      <Image
        src={iconSrc}
        alt=""
        width={size}
        height={size}
        priority={false}
        unoptimized
      />
    </span>
  )
}
