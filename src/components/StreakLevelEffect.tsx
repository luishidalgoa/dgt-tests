/**
 * Overlay animado encima del PNG del StreakIcon, coherente con la
 * representación visual del nivel.
 *
 * Solo se renderiza cuando el icono está en estado "active" — los
 * estados "frozen" y "dormant" son visualmente "apagados", añadirles
 * partículas en movimiento rompería esa intención.
 *
 * Implementación: SVG + CSS @keyframes — sin JS de animación, todo
 * declarativo y delegado al compositor del navegador. Performante
 * incluso si hay 10+ iconos en la misma página.
 *
 * Cada nivel tiene una animación distinta acorde a lo que representa:
 *   0 — Hoguera apagada → humo gris ascendiente
 *   1 — Chispa          → pequeña llama parpadeando arriba
 *   2 — Llama pequeña   → chispitas amarillas orbitando
 *   3 — Llama estable   → más chispas, más densas
 *   4 — Llama fuerte    → chispas grandes + glow pulsante
 *   5 — Hoguera intensa → muchas chispas ascendiendo + glow intenso
 *   6 — Fénix           → (futuro) llamas extendidas + plumas brillantes
 */

interface Props {
  level: number
  /** Lado en píxeles del contenedor padre (mismo `size` que StreakIcon). */
  size: number
}

export function StreakLevelEffect({ level, size }: Props) {
  // Identificador único para los keyframes (evita colisiones si hay
  // varios iconos del mismo nivel en la página — los keyframes son globales
  // pero como definen el MISMO movimiento da igual reutilizarlos).
  const id = `streak-fx-l${level}`

  // Escalamos partículas según el tamaño del icono. Definimos a 56px
  // (default de StreakIcon) y multiplicamos por la ratio.
  const k = size / 56

  switch (level) {
    case 0:
      return <SmokeAshes id={id} k={k} />
    case 1:
      return <SmallFlame id={id} k={k} />
    case 2:
      return <Sparks id={id} k={k} count={3} amplitude={0.55} />
    case 3:
      return <Sparks id={id} k={k} count={5} amplitude={0.65} />
    case 4:
      return <SparksWithGlow id={id} k={k} count={6} />
    case 5:
      return <IntenseBlaze id={id} k={k} />
    default:
      return null  // niveles 6+ aún sin animación dedicada
  }
}

// ── Nivel 0: humo gris ascendente sutil ──────────────────────────────

function SmokeAshes({ id, k }: { id: string; k: number }) {
  const styles = `
    @keyframes ${id}-rise {
      0%   { transform: translateY(0) scale(0.5);    opacity: 0; }
      25%  { opacity: 0.55; }
      100% { transform: translateY(-${28 * k}px) scale(1.3); opacity: 0; }
    }
  `
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <svg
        viewBox="0 0 100 100"
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%",
          pointerEvents: "none",
        }}
      >
        {[0, 1.3, 2.6].map((delay, i) => (
          <circle
            key={i}
            cx={47 + (i % 2) * 6}
            cy={42}
            r={5 + i * 0.5}
            fill="#94a3b8"
            style={{
              transformOrigin: "center",
              animation: `${id}-rise 4s ease-out ${delay}s infinite`,
              opacity: 0,
            }}
          />
        ))}
      </svg>
    </>
  )
}

// ── Nivel 1: pequeña llama parpadeante ────────────────────────────────

function SmallFlame({ id, k }: { id: string; k: number }) {
  void k
  const styles = `
    @keyframes ${id}-flicker {
      0%, 100% { transform: scaleY(1)    translateY(0);    opacity: 0.9; }
      50%      { transform: scaleY(1.25) translateY(-1px); opacity: 1;   }
    }
  `
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <svg
        viewBox="0 0 100 100"
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%",
          pointerEvents: "none",
        }}
      >
        <path
          d="M 50 22 Q 46 28 48 33 Q 50 28 52 33 Q 54 28 50 22 Z"
          fill="#fbbf24"
          style={{
            transformOrigin: "50% 33px",
            animation: `${id}-flicker 0.55s ease-in-out infinite`,
            filter: "drop-shadow(0 0 1.5px rgba(251, 191, 36, 0.8))",
          }}
        />
      </svg>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────
//  PATRÓN COMÚN: partículas ascendentes alrededor de la llama
// ─────────────────────────────────────────────────────────────────────
// Las partículas nacen en la base del icono (Y alto = parte baja en
// SVG), en las zonas LATERALES (izquierda 22-38 y derecha 62-78),
// dejando libre el centro 38-62 donde se renderiza la llama. Suben
// hacia arriba con drift lateral suave mientras se desvanecen.
//
// Esto es coherente para los niveles 2, 3, 4, 5 — solo cambian el
// número, color, tamaño y si hay glow alrededor.

interface AshendingSparkSpec {
  /** posición horizontal inicial (0-100, SVG units) */
  cx: number
  /** posición vertical inicial (la base de la llama, ~75-85) */
  cy: number
  /** drift lateral durante el ascenso (px) */
  dx: number
  /** distancia que sube (px). Más grande = sube más alto */
  rise: number
  delay: number
  color: string
  size: number
}

function makeAscendingSparks(count: number, palette: string[], size: number, riseDistance = 32): AshendingSparkSpec[] {
  return Array.from({ length: count }, (_, i) => {
    // Alterna lado izquierdo/derecho, evita el centro donde está la llama
    const isLeft   = i % 2 === 0
    const sideMin  = isLeft ? 22 : 62
    const sideMax  = isLeft ? 38 : 78
    const range    = sideMax - sideMin
    const cx       = sideMin + ((i * 11) % 100) / 100 * range  // pseudo-random pero estable
    // Y de salida en la mitad inferior (parte baja del icono)
    const cy       = 72 + ((i * 7) % 14)  // 72-86
    const dx       = ((i * 5) % 9) - 4    // -4..+4px drift
    const delay    = (i / count) * 1.4
    const color    = palette[i % palette.length]
    // Pequeña variación en tamaño para naturalidad
    const sz       = size + (((i * 3) % 10) / 10 - 0.5) * 0.6
    return { cx, cy, dx, rise: riseDistance, delay, color, size: sz }
  })
}

function AscendingSparks({
  id, sparks, animDuration,
}: {
  id: string
  sparks: AshendingSparkSpec[]
  animDuration: number
}) {
  // Cada chispa tiene su propia keyframe porque el rise es parametrizable
  // por var CSS, pero para simplificar reutilizamos un solo @keyframes
  // y modulamos delays / colores.
  const styles = `
    @keyframes ${id}-rise {
      0%   { transform: translate(0, 0)                              scale(0);    opacity: 0; }
      15%  { transform: translate(calc(var(--dx) * 0.3), -10%)       scale(1);    opacity: 1; }
      70%  { transform: translate(calc(var(--dx) * 0.85), -70%)      scale(0.9);  opacity: 0.7; }
      100% { transform: translate(var(--dx), -110%)                  scale(0.3);  opacity: 0; }
    }
  `
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <svg
        viewBox="0 0 100 100"
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%",
          pointerEvents: "none",
        }}
      >
        {sparks.map((s, i) => (
          <circle
            key={i}
            cx={s.cx}
            cy={s.cy}
            r={s.size}
            fill={s.color}
            style={{
              ["--dx" as string]: `${s.dx}px`,
              transformBox:    "fill-box",
              transformOrigin: "center",
              animation:       `${id}-rise ${animDuration}s ease-out ${s.delay}s infinite`,
              filter:          `drop-shadow(0 0 2px ${s.color}cc)`,
              opacity:         0,
            } as React.CSSProperties}
          />
        ))}
      </svg>
    </>
  )
}

// ── Niveles 2, 3: chispitas amarillas ascendentes desde la base ──────

function Sparks({
  id, k, count, amplitude,
}: {
  id: string; k: number; count: number; amplitude: number
}) {
  void k
  // amplitude controla la variabilidad/intensidad (0..1)
  const sparks = makeAscendingSparks(
    count,
    ["#fde047", "#facc15", "#fbbf24"],  // tonos amarillos
    1.6 * amplitude,
  )
  return <AscendingSparks id={id} sparks={sparks} animDuration={1.8} />
}

// ── Nivel 4: chispas naranjas grandes + glow pulsante ────────────────

function SparksWithGlow({ id, k, count }: { id: string; k: number; count: number }) {
  void k
  const glowId = `${id}-glow`
  const sparks = makeAscendingSparks(
    count,
    ["#fb923c", "#f97316", "#fbbf24"],  // naranjas + amarillo
    2.2,
  )
  const styles = `
    @keyframes ${glowId} {
      0%, 100% { filter: drop-shadow(0 0 3px rgba(249, 115, 22, 0.3)); }
      50%      { filter: drop-shadow(0 0 7px rgba(249, 115, 22, 0.65)); }
    }
  `
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div style={{
        position: "absolute", inset: 0,
        animation: `${glowId} 1.8s ease-in-out infinite`,
        pointerEvents: "none",
      }} />
      <AscendingSparks id={id} sparks={sparks} animDuration={1.6} />
    </>
  )
}

// ── Nivel 5: llama mágica azul/morada — chispas arcanas + glow violeta ──
// El PNG del nivel 5 muestra una llama azul/morada arcana (no fuego
// naranja convencional). Mismo patrón ascendente desde la base con
// paleta cian/azul/púrpura/blanco.

function IntenseBlaze({ id, k }: { id: string; k: number }) {
  void k
  const glowId = `${id}-glow`
  const sparks = makeAscendingSparks(
    8,
    ["#7dd3fc", "#3b82f6", "#a855f7", "#c4b5fd", "#ffffff"],
    2.0,
    36,  // rise mayor para que las chispas suban más alto
  )
  const styles = `
    @keyframes ${glowId} {
      0%, 100% { filter: drop-shadow(0 0 4px rgba(139, 92, 246, 0.45)); }
      50%      { filter: drop-shadow(0 0 11px rgba(139, 92, 246, 0.85)); }
    }
  `
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div style={{
        position: "absolute", inset: 0,
        animation: `${glowId} 1.6s ease-in-out infinite`,
        pointerEvents: "none",
      }} />
      <AscendingSparks id={id} sparks={sparks} animDuration={2.2} />
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────
//  FROZEN: efecto único para cualquier icono congelado
// ─────────────────────────────────────────────────────────────────────

/**
 * Overlay de "hielo derritiéndose" — gotas de agua que aparecen abajo
 * del cubo, ganan peso, caen y se desvanecen.
 *
 * Se usa el MISMO efecto para todos los niveles en estado frozen: la
 * variación visual entre niveles ya viene del PNG (la llama dentro del
 * cubo cambia de tamaño/color). Las gotas refuerzan visualmente la
 * idea de "se está congelando/derritiendo" en cualquier nivel.
 *
 * 3 gotas con timings desfasados para que el goteo sea continuo pero
 * no rítmico. Color azul claro semitransparente con sutil glow.
 */
export function StreakFrozenEffect({ size }: { size: number }) {
  void size
  const id = "streak-fx-frozen"
  const styles = `
    @keyframes ${id}-drop {
      0%   { transform: translateY(0)    scale(0.6); opacity: 0; }
      20%  { transform: translateY(2px)  scale(1);   opacity: 0.85; }
      55%  { transform: translateY(8px)  scale(1);   opacity: 0.95; }
      100% { transform: translateY(26px) scale(0.4); opacity: 0; }
    }
  `
  // 3 gotas distribuidas a lo ancho del icono, con delays decalados
  const drops = [
    { cx: 38, delay: 0    },
    { cx: 50, delay: 0.7  },
    { cx: 62, delay: 1.4  },
  ]
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <svg
        viewBox="0 0 100 100"
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%",
          pointerEvents: "none",
        }}
      >
        {drops.map((d, i) => (
          <ellipse
            key={i}
            cx={d.cx}
            cy={72}
            rx={2}
            ry={3}
            fill="#7dd3fc"
            style={{
              transformOrigin: `${d.cx}px 72px`,
              animation: `${id}-drop 2.1s ease-in ${d.delay}s infinite`,
              filter: "drop-shadow(0 0 1.5px rgba(125, 211, 252, 0.85))",
              opacity: 0,
            }}
          />
        ))}
      </svg>
    </>
  )
}
