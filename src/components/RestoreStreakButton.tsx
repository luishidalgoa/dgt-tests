"use client"

import { useState, useTransition, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Loader2, RefreshCw } from "lucide-react"
import { restoreStreakAction } from "@/app/actions/streak"

interface Props {
  credits: number
  /** Posiciones del ciclo (1..7) que se iluminarán al restaurar. Si
   *  está vacío hacemos restauración sin animación (fallback). El padre
   *  lo computa con `computeRestoreTargetDays` en xp.ts. */
  cycleDaysToRestore: number[]
}

/** Duración de vuelo de cada chispa, ms. */
const SPARK_FLIGHT_MS = 550
/** Delay entre el lanzamiento de cada chispa, ms. */
const SPARK_STAGGER_MS = 130
/** Cuánto se queda el chip "ardiendo" tras impactar, ms. */
const CHIP_IGNITE_MS = 800
/** Buffer extra antes de pedir al server el restore, ms. Permite que
 *  los frames de la última chispa terminen de pintarse. */
const POST_ANIM_BUFFER_MS = 150

/**
 * Botón "Restaurar racha (X intentos)" del dashboard.
 *
 * Solo se renderiza si el padre (page.tsx) ha calculado `canRestore=true`
 * — este componente NO decide eligibilidad.
 *
 * Flow al hacer click (con prefers-reduced-motion=no-preference):
 *
 *   1. Bloqueamos re-click. Botón pasa a estado `is-firing` (icono spin).
 *   2. Por cada posición en `cycleDaysToRestore`, spawneamos una chispa
 *      SVG en `position: fixed` a la coordenada del botón.
 *   3. La chispa viaja al chip correspondiente (`[data-cycle-day=N]`)
 *      con arco vía Web Animations API, escalonadas por SPARK_STAGGER_MS.
 *   4. Al aterrizar, el chip recibe `.is-igniting` → flash + scale bounce
 *      vía CSS keyframes (chipIgnite).
 *   5. Tras todas las chispas + buffer, llamamos al server action.
 *   6. Si OK: fade-out del botón (`is-leaving`) + `router.refresh()` —
 *      el re-render del Server Component ya trae los chips con su estado
 *      "earned" real, sin parpadeo.
 *   7. Si error: revertimos la animación y mostramos el mensaje.
 *
 * Con prefers-reduced-motion=reduce, saltamos pasos 2-4 y llamamos
 * directo al server.
 */
export function RestoreStreakButton({ credits, cycleDaysToRestore }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // `isFiring`  = animación en curso. `isLeaving` = fade-out final.
  const [isFiring, setIsFiring] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const runServerAction = useCallback(() => {
    startTransition(async () => {
      try {
        const res = await restoreStreakAction()
        if (!res.ok) {
          setError(res.error)
          setIsFiring(false)
          setIsLeaving(false)
          return
        }
        setIsLeaving(true)
        // El refresh dispara un re-render del Server Component padre, que
        // ya no incluirá este botón (canRestore pasará a false). Le damos
        // 200 ms al CSS para que termine el fade antes de que React
        // desmonte.
        setTimeout(() => router.refresh(), 200)
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error desconocido")
        setIsFiring(false)
        setIsLeaving(false)
      }
    })
  }, [router])

  const handleClick = useCallback(() => {
    if (isPending || isFiring) return
    setError(null)

    const btn = buttonRef.current
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches

    // Sin animación: degradación elegante para reduced-motion / SSR / chips
    // no encontrados. Llamamos al server directamente.
    if (reduceMotion || !btn || cycleDaysToRestore.length === 0) {
      runServerAction()
      return
    }

    // Localiza los chips destino en el DOM. Si alguno falta (cycle no
    // está montado todavía por algún motivo), también fallback.
    const targetChips = cycleDaysToRestore
      .map((day) => document.querySelector(`[data-cycle-day="${day}"]`))
      .filter((el): el is HTMLElement => el instanceof HTMLElement)

    if (targetChips.length === 0) {
      runServerAction()
      return
    }

    setIsFiring(true)
    const btnRect = btn.getBoundingClientRect()
    const originX = btnRect.left + btnRect.width / 2
    const originY = btnRect.top + btnRect.height / 2

    targetChips.forEach((chip, i) => {
      window.setTimeout(() => {
        const chipRect = chip.getBoundingClientRect()
        const targetX = chipRect.left + chipRect.width / 2
        const targetY = chipRect.top + chipRect.height / 2

        const dx = targetX - originX
        const dy = targetY - originY
        // Pico del arco: 30 px por encima del punto medio, más alto si
        // el vuelo es largo. Queda un trayecto natural en lugar de
        // recto.
        const arcPeakY = dy - Math.abs(dx) * 0.18 - 35

        // Spawn de la chispa
        const spark = document.createElement("span")
        spark.className = "restore-spark"
        spark.style.left = `${originX}px`
        spark.style.top = `${originY}px`
        document.body.appendChild(spark)

        // Web Animations API: trayectoria con 5 keyframes para el arco.
        const anim = spark.animate(
          [
            { transform: "translate(-50%, -50%) scale(0.5)", opacity: 0, offset: 0 },
            { transform: "translate(-50%, -50%) scale(1.3)", opacity: 1, offset: 0.08 },
            {
              transform:
                `translate(calc(${dx * 0.5}px - 50%), calc(${arcPeakY}px - 50%)) scale(1)`,
              opacity: 1,
              offset: 0.5,
            },
            {
              transform:
                `translate(calc(${dx}px - 50%), calc(${dy}px - 50%)) scale(1.6)`,
              opacity: 1,
              offset: 0.9,
            },
            {
              transform:
                `translate(calc(${dx}px - 50%), calc(${dy}px - 50%)) scale(0.2)`,
              opacity: 0,
              offset: 1,
            },
          ],
          {
            duration: SPARK_FLIGHT_MS,
            easing:   "cubic-bezier(0.42, 0, 0.58, 1)",
            fill:     "forwards",
          },
        )

        anim.onfinish = () => {
          spark.remove()
          chip.classList.add("is-igniting")
          window.setTimeout(
            () => chip.classList.remove("is-igniting"),
            CHIP_IGNITE_MS,
          )
        }
      }, i * SPARK_STAGGER_MS)
    })

    // Cuando aterriza la última chispa, pedimos al server. La animación
    // de ignición de los chips sigue en paralelo (no la bloqueamos).
    const lastSparkLandsAt =
      (targetChips.length - 1) * SPARK_STAGGER_MS + SPARK_FLIGHT_MS
    window.setTimeout(runServerAction, lastSparkLandsAt + POST_ANIM_BUFFER_MS)
  }, [cycleDaysToRestore, isFiring, isPending, runServerAction])

  const intentosLabel = `${credits} ${credits === 1 ? "intento" : "intentos"}`
  const tooltip =
    `Solo puedes restaurar la racha el día siguiente a haberse roto. ` +
    `Tienes ${intentosLabel} restante${credits === 1 ? "" : "s"} — ` +
    `ganas +1 cada 7 días seguidos (máximo 5).`

  const showSpinner = isPending || isFiring
  const btnClass =
    "restore-streak-btn" +
    (isFiring ? " is-firing" : "") +
    (isLeaving ? " is-leaving" : "")

  return (
    <div
      style={{
        display:       "flex",
        flexDirection: "column",
        gap:           4,
        marginTop:     12,
        marginBottom:  18,
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        disabled={showSpinner || isLeaving}
        aria-label={`Restaurar racha rota — ${intentosLabel} restante${credits === 1 ? "" : "s"}`}
        title={tooltip}
        className={btnClass}
        style={{
          display:        "inline-flex",
          alignItems:     "center",
          gap:            8,
          padding:        "8px 14px",
          borderRadius:   10,
          border:         "1px solid var(--orange-500)",
          background:     "linear-gradient(180deg, #fff, #fff7ed)",
          color:          "var(--orange-600)",
          fontWeight:     700,
          fontSize:       13,
          cursor:         showSpinner ? "wait" : "pointer",
          alignSelf:      "flex-start",
        }}
      >
        {showSpinner
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : <RefreshCw className="h-4 w-4 refresh-icon" />}
        <span>Restaurar racha</span>
        <span
          style={{
            display:       "inline-flex",
            alignItems:    "center",
            padding:       "1px 8px",
            borderRadius:  999,
            background:    "var(--orange-500)",
            color:         "#fff",
            fontSize:      11.5,
            fontWeight:    800,
            letterSpacing: "0.02em",
          }}
        >
          {intentosLabel}
        </span>
      </button>
      {error && (
        <span
          role="alert"
          style={{ fontSize: 12, color: "var(--red-500)", fontWeight: 600 }}
        >
          {error}
        </span>
      )}
    </div>
  )
}
