"use client"

import { useEffect, useRef } from "react"
import { trackEvent, type AnalyticsEvent, type AnalyticsProps } from "@/lib/analytics"

interface Props {
  event:  AnalyticsEvent
  props?: AnalyticsProps
}

/**
 * Componente "invisible" que dispara un trackEvent al montarse.
 *
 * Pensado para añadir tracking a páginas que son Server Components: el
 * trackEvent solo puede correr en cliente, así que un Server Component
 * embebe este wrapper y el cliente lo hidrata + dispara el evento UNA
 * vez por navegación a esa página.
 *
 * Uso:
 *   export default async function TestErroresPage() {
 *     return (
 *       <>
 *         <TrackPageView event="errors_test_started" />
 *         ...resto de la page...
 *       </>
 *     )
 *   }
 *
 * Idempotencia: usa una ref para garantizar 1 sola llamada por mount,
 * aunque el effect corra varias veces por StrictMode en dev o
 * re-renders por prop change (no debería pasar, pero defensivo).
 */
export function TrackPageView({ event, props }: Props) {
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    trackEvent(event, props)
  }, [event, props])
  return null
}
