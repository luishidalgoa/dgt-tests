"use client"

import { useState, useTransition, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Loader2, RefreshCw } from "lucide-react"
import { restoreStreakAction } from "@/app/actions/streak"

interface Props {
  credits: number
  /** Posiciones del ciclo (1..7) que pasarán a "earned" tras la
   *  restauración. Las usamos solo para aplicarles un fade-in suave
   *  como CONSECUENCIA de la restauración — la animación principal
   *  va al día roto en el chart, no a estos chips. */
  cycleDaysToRestore: number[]
}

/** Duración del vuelo de la chispa, ms. */
const SPARK_FLIGHT_MS = 600
/** Cuánto se queda el chip yesterday descongelándose, ms. */
const THAW_DURATION_MS = 600
/** Buffer extra antes de pedir al server, ms. */
const POST_ANIM_BUFFER_MS = 150

/**
 * Botón "Restaurar racha (X intentos)" del dashboard.
 *
 * Solo se renderiza si el padre (page.tsx) ha calculado `canRestore=true`
 * — este componente NO decide eligibilidad.
 *
 * Animación al pulsar (semántica de RESCATE, no de recompensa: NO se
 * concede XP retroactiva, solo se reconecta la cadena):
 *
 *   1. Botón pasa a `is-firing` (icono refresh gira rápido).
 *   2. UNA chispa AZUL (color hielo, no fuego — la metáfora es
 *      "descongelar") sale del centro del botón con arco y llega al
 *      chip de ayer en el chart (`[data-day-offset="-1"]`).
 *   3. Al impactar, el chip ayer recibe `.is-thawing` → overlay con
 *      patrón rayado azul + ❄ apareciendo con scale-bounce.
 *   4. Simultáneamente: los chips del ciclo en `cycleDaysToRestore`
 *      reciben `.is-rekindling` → fade suave de gris → naranja. Es la
 *      CONSECUENCIA visible de la reconexión, no la acción.
 *   5. Tras la animación + buffer: server action.
 *   6. Server OK → `.is-leaving` fade-out del botón + `router.refresh()`.
 *      El re-render trae los chips de verdad en su estado restaurado.
 *
 * Fallback con prefers-reduced-motion=reduce: salta animaciones,
 * llama directo al server.
 */
export function RestoreStreakButton({ credits, cycleDaysToRestore }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
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
    const yesterdayChip = document.querySelector<HTMLElement>(
      '[data-day-offset="-1"]',
    )
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches

    // Sin animación: degradación elegante.
    if (reduceMotion || !btn || !yesterdayChip) {
      runServerAction()
      return
    }

    setIsFiring(true)

    // Coordenadas: del centro del botón al centro del chip de ayer.
    const btnRect  = btn.getBoundingClientRect()
    const chipRect = yesterdayChip.getBoundingClientRect()
    const oX = btnRect.left + btnRect.width / 2
    const oY = btnRect.top + btnRect.height / 2
    const tX = chipRect.left + chipRect.width / 2
    const tY = chipRect.top + chipRect.height / 2
    const dx = tX - oX
    const dy = tY - oY
    // Pico del arco — para vuelos cortos hacia abajo el arco es leve.
    const arcPeakY = dy - Math.abs(dx) * 0.15 - 30

    // Spawn de la chispa AZUL (variante .is-rescue).
    const spark = document.createElement("span")
    spark.className = "restore-spark is-rescue"
    spark.style.left = `${oX}px`
    spark.style.top = `${oY}px`
    document.body.appendChild(spark)

    const anim = spark.animate(
      [
        { transform: "translate(-50%, -50%) scale(0.5)", opacity: 0, offset: 0 },
        { transform: "translate(-50%, -50%) scale(1.4)", opacity: 1, offset: 0.08 },
        {
          transform:
            `translate(calc(${dx * 0.5}px - 50%), calc(${arcPeakY}px - 50%)) scale(1.1)`,
          opacity: 1,
          offset:  0.5,
        },
        {
          transform:
            `translate(calc(${dx}px - 50%), calc(${dy}px - 50%)) scale(1.5)`,
          opacity: 1,
          offset:  0.92,
        },
        {
          transform:
            `translate(calc(${dx}px - 50%), calc(${dy}px - 50%)) scale(0.3)`,
          opacity: 0,
          offset:  1,
        },
      ],
      {
        duration: SPARK_FLIGHT_MS,
        easing:   "cubic-bezier(0.42, 0, 0.58, 1)",
        fill:     "forwards",
      },
    )

    // Cuando la chispa aterriza:
    //   - chip yesterday se "descongela" con overlay.
    //   - chips del ciclo destinados a iluminarse: fade suave (consecuencia).
    anim.onfinish = () => {
      spark.remove()
      yesterdayChip.classList.add("is-thawing")
      // Limpiamos la clase tras la duración del thaw — el chip volverá
      // a su estado natural cuando el server-component re-renderice con
      // restored=true.
      window.setTimeout(
        () => yesterdayChip.classList.remove("is-thawing"),
        THAW_DURATION_MS,
      )

      // Fade suave en los chips del ciclo afectados.
      for (const day of cycleDaysToRestore) {
        const chip = document.querySelector<HTMLElement>(
          `[data-cycle-day="${day}"]`,
        )
        if (!chip) continue
        chip.classList.add("is-rekindling")
        window.setTimeout(
          () => chip.classList.remove("is-rekindling"),
          THAW_DURATION_MS + 100,
        )
      }
    }

    // Tras la animación + buffer, pedimos al server.
    window.setTimeout(
      runServerAction,
      SPARK_FLIGHT_MS + THAW_DURATION_MS / 2 + POST_ANIM_BUFFER_MS,
    )
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
