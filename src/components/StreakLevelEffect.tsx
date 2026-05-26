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

// ── Niveles 2, 3: chispitas amarillas alrededor ───────────────────────

function Sparks({
  id, k, count, amplitude,
}: {
  id: string; k: number; count: number; amplitude: number
}) {
  void k
  // amplitude = 0..1, cuánto se mueven las chispas
  const r = 38 * amplitude  // radio del orbital
  const styles = `
    @keyframes ${id}-spark {
      0%   { transform: scale(0); opacity: 0; }
      30%  { transform: scale(1); opacity: 0.95; }
      100% { transform: scale(0.3); opacity: 0; }
    }
  `
  // Distribuir chispas alrededor del centro a 50,50
  const sparks = Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2
    const cx = 50 + Math.cos(angle) * r
    const cy = 50 + Math.sin(angle) * r * 0.7  // elipse vertical
    const delay = (i / count) * 1.2
    return { cx, cy, delay }
  })
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
            r={1.8}
            fill="#fde047"
            style={{
              transformOrigin: `${s.cx}px ${s.cy}px`,
              animation: `${id}-spark 1.6s ease-in-out ${s.delay}s infinite`,
              filter: "drop-shadow(0 0 2px rgba(253, 224, 71, 0.9))",
              opacity: 0,
            }}
          />
        ))}
      </svg>
    </>
  )
}

// ── Nivel 4: chispas grandes + glow pulsante alrededor ────────────────

function SparksWithGlow({ id, k, count }: { id: string; k: number; count: number }) {
  void k
  const styles = `
    @keyframes ${id}-spark   {
      0%   { transform: scale(0)   translateY(0);          opacity: 0; }
      30%  { transform: scale(1.2) translateY(-2px);       opacity: 1; }
      100% { transform: scale(0.4) translateY(-8px);       opacity: 0; }
    }
    @keyframes ${id}-glow {
      0%, 100% { filter: drop-shadow(0 0 3px rgba(249, 115, 22, 0.3)); }
      50%      { filter: drop-shadow(0 0 7px rgba(249, 115, 22, 0.65)); }
    }
  `
  const sparks = Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2
    const cx = 50 + Math.cos(angle) * 30
    const cy = 50 + Math.sin(angle) * 22
    return { cx, cy, delay: (i / count) * 1.0 }
  })
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div style={{
        position: "absolute", inset: 0,
        animation: `${id}-glow 1.8s ease-in-out infinite`,
        pointerEvents: "none",
      }} />
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
            r={2.5}
            fill="#fb923c"
            style={{
              transformOrigin: `${s.cx}px ${s.cy}px`,
              animation: `${id}-spark 1.4s ease-out ${s.delay}s infinite`,
              filter: "drop-shadow(0 0 2.5px rgba(251, 146, 60, 0.9))",
              opacity: 0,
            }}
          />
        ))}
      </svg>
    </>
  )
}

// ── Nivel 5: hoguera intensa — chispas grandes ascendentes + glow rojo ──

function IntenseBlaze({ id, k }: { id: string; k: number }) {
  void k
  const styles = `
    @keyframes ${id}-ember {
      0%   { transform: translate(0, 0)     scale(0);   opacity: 0; }
      20%  { opacity: 1; }
      100% { transform: translate(var(--dx), -30px) scale(0.5); opacity: 0; }
    }
    @keyframes ${id}-heatglow {
      0%, 100% { filter: drop-shadow(0 0 4px rgba(220, 38, 38, 0.45)); }
      50%      { filter: drop-shadow(0 0 10px rgba(220, 38, 38, 0.85)); }
    }
  `
  // 8 brasas ascendentes con drift lateral aleatorio (pseudo, fijo por index)
  const embers = Array.from({ length: 8 }, (_, i) => {
    const startX = 30 + ((i * 7) % 40)
    const startY = 60 + ((i * 3) % 15)
    const dx = ((i * 5) % 11) - 5   // -5..+5px de drift lateral
    const delay = (i * 0.25) % 2.0
    const colors = ["#fb923c", "#f97316", "#ef4444", "#fbbf24"]
    return { startX, startY, dx, delay, color: colors[i % colors.length] }
  })
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div style={{
        position: "absolute", inset: 0,
        animation: `${id}-heatglow 1.6s ease-in-out infinite`,
        pointerEvents: "none",
      }} />
      <svg
        viewBox="0 0 100 100"
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%",
          pointerEvents: "none",
        }}
      >
        {embers.map((e, i) => (
          <circle
            key={i}
            cx={e.startX}
            cy={e.startY}
            r={1.8}
            fill={e.color}
            style={{
              ["--dx" as string]: `${e.dx}px`,
              animation: `${id}-ember 2.2s ease-out ${e.delay}s infinite`,
              filter: `drop-shadow(0 0 2px ${e.color}cc)`,
              opacity: 0,
            } as React.CSSProperties}
          />
        ))}
      </svg>
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
