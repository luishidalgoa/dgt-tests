import Image from "next/image"
import { getLevel } from "@/lib/xpLevels"
import { StreakLevelEffect } from "./StreakLevelEffect"

/**
 * Estado visual del icono:
 *   - "active":   racha viva (mostrar el icono del nivel a color).
 *   - "frozen":   tenía racha pero hoy aún no se ha hecho nada — se
 *                 renderiza el asset "congelado" (lvl-N-freeze.png) si
 *                 existe, o se aplica un filtro CSS azul como fallback.
 *   - "dormant":  el usuario no tiene racha (siempre lvl-0).
 *
 * Renderiza siempre el PNG del nivel correspondiente. Los assets son
 * detallados (silueta + brasa + chispa) y necesitan al menos ~56 px de
 * lado para que los trazos finos sean legibles. El caller decide el
 * tamaño vía la prop `size`.
 *
 * Si el PNG aún no existe (estamos generando los assets de nivel 1..6),
 * Next/Image mostrará un 404 silencioso; el contenedor mantiene su tamaño.
 */
export type StreakIconState = "active" | "frozen" | "dormant"

interface StreakIconProps {
  /** XP del usuario. De aquí se deriva el nivel y por tanto el icono. */
  xp: number
  /** Lado en píxeles (cuadrado). Default 56 — más pequeño y los dashes
   *  finos del nivel 0 se vuelven ilegibles. */
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
  size = 56,
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
  // un filtro CSS azul sobre el icono base.
  //
  // Excepción: el nivel 0 (llama apagada) NO necesita variante frozen
  // — su PNG ya es un outline dashed pálido que transmite "inactivo"
  // por sí solo. Aplicarle un filtro azul lo destroza visualmente.
  const useFrozenAsset = state === "frozen" && info.frozenIconPath !== null
  const iconSrc = useFrozenAsset ? info.frozenIconPath! : info.iconPath
  const filter =
    state === "frozen" && !useFrozenAsset && info.level > 0
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
        position:       "relative",
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
      {/* Overlay animado por nivel (humo, llamas, chispas...).
          Solo en estado "active" — frozen y dormant son visualmente
          apagados y la animación rompería esa intención. */}
      {state === "active" && (
        <StreakLevelEffect level={info.level} size={size} />
      )}
    </span>
  )
}
