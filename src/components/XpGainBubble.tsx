"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import type { AttemptXpReward } from "@/types/exam"
import { XP_GAIN_STORAGE_KEY } from "@/lib/xpAnimation"

/** Clave en sessionStorage. Centralizada en xpAnimation.ts para que
 *  ExamRunner (escritor) y XpGainBubble (lector) usen el mismo string. */
const STORAGE_KEY = XP_GAIN_STORAGE_KEY

/** Cuánto se queda visible el bubble tras terminar la animación, ms. */
const HOLD_AFTER_FILL_MS = 1800
/** Duración del fill de la barra de XP (ease-out), ms. */
const BAR_FILL_MS = 1300
/** Duración del fade-in inicial del bubble, ms. */
const ENTER_MS = 250
/** Duración del fade-out final, ms. */
const EXIT_MS = 320

/**
 * Animación efímera que aparece cerca del avatar tras un examen real
 * para celebrar el XP ganado. Aparece, anima la barra y dispara
 * pelotitas naranjas volando hacia ella, y se desvanece.
 *
 * Origen de los datos: `ExamRunner` deja un `AttemptXpReward` en
 * `sessionStorage[dgt:xp-gain]` justo antes del redirect. Este
 * componente (montado en `layout.tsx`) lo lee, lo borra, y dispara la
 * animación.
 *
 * Por qué sessionStorage en vez de un state global: porque el
 * `router.push()` desde ExamRunner navega a otra ruta (resultado/
 * historial) y el componente cliente del runner se desmonta. Los
 * Server Components del layout NO comparten state con los Client
 * Components. sessionStorage es el bridge más simple y dura justo lo
 * que necesitamos.
 */
export function XpGainBubble() {
  const pathname = usePathname()
  const [data, setData] = useState<AttemptXpReward | null>(null)
  const [phase, setPhase] = useState<"enter" | "filling" | "hold" | "exit" | null>(
    null,
  )
  const sparkContainerRef = useRef<HTMLDivElement>(null)
  const timersRef = useRef<number[]>([])
  // Offset desde el borde derecho de la viewport. Lo medimos en cada
  // entrada midiendo el grupo derecho del navbar (`.nav-right`) para
  // que la bubble quede alineada con el borde derecho del avatar/menu
  // en lugar de pegada al borde de la pantalla. En mobile (≤640px) el
  // CSS gana (max-width:none + left/right:12) y este valor se ignora.
  const [rightOffset, setRightOffset] = useState<number | null>(null)

  // Detecta nuevo XP en sessionStorage en cada cambio de ruta (incluido
  // el primer mount tras el redirect post-examen).
  //
  // El set-state-in-effect aquí es intencional: sessionStorage ES el
  // "external system" del que sincronizamos. El cambio de ruta es el
  // trigger; consumimos el mensaje (borrando la key) y arrancamos el
  // ciclo de animación. No es un cascading-render anti-pattern porque
  // sessionStorage no reacciona en React-land — necesitamos el setState
  // explícito para empezar las fases.
  useEffect(() => {
    if (typeof window === "undefined") return
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return
    window.sessionStorage.removeItem(STORAGE_KEY)

    let parsed: AttemptXpReward
    try {
      parsed = JSON.parse(raw) as AttemptXpReward
    } catch {
      return
    }
    if (!parsed || parsed.awarded <= 0) return

    // Reset any prior animation
    for (const t of timersRef.current) window.clearTimeout(t)
    timersRef.current = []

    // Medir el grupo derecho del navbar para alinear la bubble en el
    // eje X. Si no existe (rutas sin navbar), usar fallback 16px.
    const navRight = document.querySelector<HTMLElement>(".nav-right")
    if (navRight) {
      const rect = navRight.getBoundingClientRect()
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRightOffset(window.innerWidth - rect.right)
    } else {
       
      setRightOffset(null)
    }

     
    setData(parsed)
     
    setPhase("enter")
  }, [pathname])

  // Orquesta las fases: enter → filling (barra + chispas) → hold → exit → null.
  useEffect(() => {
    if (phase === null) return

    if (phase === "enter") {
      const t = window.setTimeout(() => setPhase("filling"), ENTER_MS)
      timersRef.current.push(t)
      return
    }

    if (phase === "filling") {
      spawnSparks(sparkContainerRef.current, data?.awarded ?? 0)
      const t = window.setTimeout(() => setPhase("hold"), BAR_FILL_MS)
      timersRef.current.push(t)
      return
    }

    if (phase === "hold") {
      const t = window.setTimeout(() => setPhase("exit"), HOLD_AFTER_FILL_MS)
      timersRef.current.push(t)
      return
    }

    if (phase === "exit") {
      const t = window.setTimeout(() => {
        setPhase(null)
        setData(null)
      }, EXIT_MS)
      timersRef.current.push(t)
    }
  }, [phase, data?.awarded])

  // Cleanup en unmount.
  useEffect(() => {
    return () => {
      for (const t of timersRef.current) window.clearTimeout(t)
    }
  }, [])

  if (!data || phase === null) return null

  const isMax = data.nextLevelXp === null
  // % al iniciar el fill (XP previo) y % objetivo (XP nuevo).
  const startPct = isMax || data.nextLevelXp === null
    ? 100
    : Math.max(0, Math.min(100, (data.prevXp / data.nextLevelXp) * 100))
  const endPct = data.progressPct
  // Durante "enter" la barra está en startPct. Durante "filling+" en endPct.
  const fillPct = phase === "enter" ? startPct : endPct

  const enteringOrExiting = phase === "enter" || phase === "exit"

  return (
    <div
      className="xp-gain-bubble"
      data-phase={phase}
      role="status"
      aria-live="polite"
      style={{
        opacity:   enteringOrExiting ? 0 : 1,
        transform: enteringOrExiting ? "translateY(-8px) scale(0.96)" : "none",
        // Si medimos el nav-right, alineamos con su borde derecho.
        // Usamos max(16, offset) para no acercarse demasiado al borde
        // si el nav está muy a la izquierda. En mobile la media query
        // sobreescribe esto con !important via left/right=12.
        ...(rightOffset !== null ? { right: `${Math.max(16, rightOffset)}px` } : {}),
      }}
    >
      <div className="xp-gain-bubble__head">
        <span className="xp-gain-bubble__icon" aria-hidden="true">⚡</span>
        <span className="xp-gain-bubble__delta">+{data.awarded} XP</span>
        <span className="xp-gain-bubble__level">
          Nivel {data.newLevel}
        </span>
      </div>
      <div className="xp-gain-bubble__bar">
        <div
          className="xp-gain-bubble__bar-fill"
          style={{ width: `${fillPct}%` }}
        />
      </div>
      <div className="xp-gain-bubble__meta">
        {isMax
          ? `${data.newXp} XP · MAX`
          : `${data.newXp} / ${data.nextLevelXp} XP`}
      </div>
      <div ref={sparkContainerRef} className="xp-gain-bubble__sparks" aria-hidden="true" />
    </div>
  )
}

/**
 * Spawnea pelotitas naranjas que vuelan en arco hacia el contenedor de
 * la barra de XP. Cada pelotita es un span con CSS gradient + Web
 * Animations API para el movimiento.
 *
 * El número de pelotitas se escala con el XP ganado pero queda capped:
 * 1 pelotita por cada 4 XP, mínimo 4, máximo 12.
 */
function spawnSparks(container: HTMLDivElement | null, awarded: number) {
  if (!container) return
  if (typeof window === "undefined") return
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  if (reduceMotion) return

  const count = Math.max(4, Math.min(12, Math.round(awarded / 4)))
  const containerRect = container.getBoundingClientRect()

  for (let i = 0; i < count; i++) {
    window.setTimeout(() => {
      const spark = document.createElement("span")
      spark.className = "xp-spark"
      // Origen: borde inferior-derecha de la viewport (donde un toast
      // típico aparece, sensación de "viene del juego").
      const originX = window.innerWidth - 40
      const originY = window.innerHeight - 40
      // Destino: punto aleatorio dentro de la barra de XP del bubble.
      const targetX = containerRect.left + Math.random() * containerRect.width
      const targetY = containerRect.top + containerRect.height / 2
      const dx = targetX - originX
      const dy = targetY - originY
      // Pico del arco: bastante arriba para dar vuelo épico.
      const arcPeakY = dy - Math.abs(dx) * 0.12 - 80 - Math.random() * 40

      spark.style.left = `${originX}px`
      spark.style.top = `${originY}px`
      document.body.appendChild(spark)

      const anim = spark.animate(
        [
          { transform: "translate(-50%, -50%) scale(0.4)", opacity: 0, offset: 0 },
          { transform: "translate(-50%, -50%) scale(1.2)", opacity: 1, offset: 0.08 },
          {
            transform:
              `translate(calc(${dx * 0.55}px - 50%), calc(${arcPeakY}px - 50%)) scale(1.05)`,
            opacity: 1,
            offset: 0.55,
          },
          {
            transform:
              `translate(calc(${dx}px - 50%), calc(${dy}px - 50%)) scale(1.4)`,
            opacity: 1,
            offset: 0.92,
          },
          {
            transform:
              `translate(calc(${dx}px - 50%), calc(${dy}px - 50%)) scale(0.2)`,
            opacity: 0,
            offset: 1,
          },
        ],
        {
          duration: 700 + Math.random() * 250,
          easing:   "cubic-bezier(0.42, 0, 0.58, 1)",
          fill:     "forwards",
        },
      )
      anim.onfinish = () => spark.remove()
    }, i * 70)
  }
}
