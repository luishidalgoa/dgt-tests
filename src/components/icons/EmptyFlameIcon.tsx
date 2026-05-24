/**
 * Icono SVG inline para el nivel 0 del sistema de racha.
 *
 * Sustituye al PNG `/streak/lvl-0.png`, que era apenas visible (línea
 * discontinua super clara sobre fondo blanco). El SVG:
 *   - Contorno de llama en slate-400 (suficiente contraste sobre blanco).
 *   - Trazo discontinuo (dashed) para sugerir "aún no encendida".
 *   - Pequeña brasa naranja en la base = chispa de vida / promesa.
 *
 * Variante `frozen`:
 *   - Cubo de hielo (rect redondeado sky-400) envolviendo la llama.
 *   - Llama interna en tonos azul/cian para que se lea "congelada".
 *   - Dos copos de nieve decorativos en las esquinas.
 *
 * Diseñado para tamaños 28-48 px (caja viewBox 48×48). El stroke-width
 * y dasharray escalan razonablemente.
 */

interface Props {
  /** Lado en píxeles. Default 36 (coincide con el StreakIcon estándar). */
  size?: number
  /** Si true, renderiza la llama dentro de un cubo de hielo. */
  frozen?: boolean
  /** ClassName extra para el contenedor SVG. */
  className?: string
  /** Etiqueta accesible. Si no se pasa, el SVG va aria-hidden. */
  ariaLabel?: string
}

// Path de la silueta de llama clásica (teardrop con curl). Centrada en
// (24,24) dentro de un viewBox 48×48.
const FLAME_PATH =
  "M 24 6 " +
  "C 18 10 14 22 16 32 " +
  "C 17 40 22 44 24 44 " +
  "C 26 44 31 40 32 32 " +
  "C 34 22 30 10 24 6 Z"

export function EmptyFlameIcon({ size = 36, frozen = false, className, ariaLabel }: Props) {
  const accessibilityProps = ariaLabel
    ? { role: "img" as const, "aria-label": ariaLabel }
    : { "aria-hidden": true as const }

  if (frozen) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        {...accessibilityProps}
      >
        {/* Cubo de hielo de fondo */}
        <rect
          x="4"
          y="4"
          width="40"
          height="40"
          rx="8"
          fill="rgba(186, 230, 253, 0.28)"
          stroke="#0ea5e9"
          strokeWidth="1.5"
        />
        {/* Brillos del hielo (reflejos) */}
        <path
          d="M 8 12 L 14 8"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M 32 38 L 38 34"
          stroke="rgba(255,255,255,0.6)"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        {/* Llama vacía dentro, en tonos azul */}
        <path
          d={FLAME_PATH}
          fill="rgba(125, 211, 252, 0.18)"
          stroke="#0284c7"
          strokeWidth="1.8"
          strokeDasharray="3 2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Chispita congelada en la base (azul claro) */}
        <ellipse cx="24" cy="40" rx="4" ry="1.5" fill="rgba(56, 189, 248, 0.35)" />
        {/* Dos copos de nieve mini en esquinas */}
        <g stroke="#0ea5e9" strokeWidth="1.2" strokeLinecap="round">
          <g transform="translate(11 33) rotate(15)">
            <line x1="-3" y1="0" x2="3" y2="0" />
            <line x1="0" y1="-3" x2="0" y2="3" />
            <line x1="-2" y1="-2" x2="2" y2="2" />
            <line x1="-2" y1="2" x2="2" y2="-2" />
          </g>
          <g transform="translate(37 14) rotate(20)">
            <line x1="-2.5" y1="0" x2="2.5" y2="0" />
            <line x1="0" y1="-2.5" x2="0" y2="2.5" />
          </g>
        </g>
      </svg>
    )
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...accessibilityProps}
    >
      {/* Contorno de la llama vacía */}
      <path
        d={FLAME_PATH}
        fill="rgba(249, 115, 22, 0.06)"
        stroke="var(--slate-400, #94a3b8)"
        strokeWidth="2"
        strokeDasharray="4 3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Brasa visible en la base — única parte "viva" del icono lvl-0 */}
      <ellipse cx="24" cy="40.5" rx="6" ry="2" fill="#fdba74" opacity="0.75" />
      <circle cx="24" cy="39" r="2.2" fill="#f59e0b" />
      <circle cx="24" cy="38.5" r="1" fill="#fef3c7" />
    </svg>
  )
}
