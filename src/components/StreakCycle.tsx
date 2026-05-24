import { buildCycleView, type StreakStateKind } from "@/lib/xp"
import { Check, Snowflake } from "lucide-react"

interface StreakCycleProps {
  state: StreakStateKind
  days: number
  claimedToday: boolean
}

/**
 * Visualización del ciclo actual de bonus de racha (7 días).
 *
 *   - Cada chip = un día del ciclo.
 *   - earned         : verde con check ✓ y el valor.
 *   - today + earned : naranja vivo con check (lo de hoy, ya cobrado).
 *   - today          : outline naranja sin check ("si juegas hoy ganas X").
 *   - upcoming       : gris claro, valor atenuado.
 *
 * El componente es 100% server-side: recibe el estado pre-computado
 * desde el dashboard. No hace fetch.
 */
export function StreakCycle({ state, days, claimedToday }: StreakCycleProps) {
  const slots = buildCycleView({ state, days, claimedToday })

  // Mensaje resumen bajo los chips. Adapta según estado.
  const summary = (() => {
    if (state === "active") {
      const todaySlot = slots.find((s) => s.isToday)
      if (claimedToday && todaySlot) {
        const nextSlot = slots[todaySlot.day] // siguiente posición (0-indexada)
        if (nextSlot) {
          return `Ganados hoy: +${todaySlot.bonus} XP · mañana: +${nextSlot.bonus} XP`
        }
        return `Ganados hoy: +${todaySlot.bonus} XP · mañana empieza un nuevo ciclo`
      }
      if (todaySlot) {
        return `Reclama hoy +${todaySlot.bonus} XP haciendo un test`
      }
      return null
    }
    if (state === "frozen") {
      const todaySlot = slots.find((s) => s.isToday)
      if (todaySlot) {
        return `❄ Racha congelada. Haz un test hoy para reclamar +${todaySlot.bonus} XP`
      }
      // Ciclo entero ganado pero hoy no se ha jugado — mañana arranca uno nuevo.
      return "❄ Racha congelada. Ciclo completado — mañana empieza uno nuevo"
    }
    return "Empieza una racha hoy y consigue +5 XP de bonus"
  })()

  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          fontSize: 11.5,
          fontWeight: 800,
          color: "rgba(255,255,255,0.9)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 8,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {state === "frozen" && <Snowflake className="h-3.5 w-3.5" />}
        Ciclo de racha · día {Math.min(7, ((days - 1) % 7) + (days > 0 ? 1 : 0)) || (state === "dormant" ? 0 : 1)}/7
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 6,
        }}
        role="list"
        aria-label="Bonus diarios del ciclo actual de racha"
      >
        {slots.map((slot) => {
          // Combinaciones visuales:
          //   - earned + today  → "ganado hoy" (más brillante)
          //   - earned          → "ganado en este ciclo"
          //   - today           → "hoy pendiente" (outline)
          //   - upcoming        → "futuro" (apagado)
          const isEarnedToday = slot.isEarned && slot.isToday
          const isEarned      = slot.isEarned && !slot.isToday
          const isPending     = slot.isToday && !slot.isEarned

          let background = "rgba(255,255,255,0.10)"
          let color      = "rgba(255,255,255,0.55)"
          let border     = "1px solid rgba(255,255,255,0.18)"
          let boxShadow  = "none"
          if (isEarnedToday) {
            background = "linear-gradient(180deg, #FFD24A, #FF7A1A)"
            color      = "#1a0c00"
            border     = "1px solid rgba(255,255,255,0.6)"
            boxShadow  = "0 0 0 2px rgba(255, 210, 74, 0.45)"
          } else if (isEarned) {
            background = "rgba(255, 210, 74, 0.85)"
            color      = "#1a0c00"
            border     = "1px solid rgba(255,255,255,0.4)"
          } else if (isPending) {
            background = "rgba(255,255,255,0.05)"
            color      = "#fff"
            border     = "2px dashed rgba(255, 210, 74, 0.85)"
            boxShadow  = "0 0 0 2px rgba(255, 210, 74, 0.2)"
          }

          return (
            <div
              key={slot.day}
              role="listitem"
              title={
                isEarnedToday
                  ? `Día ${slot.day} · hoy · +${slot.bonus} XP ganados`
                  : isEarned
                  ? `Día ${slot.day} · ya ganado · +${slot.bonus} XP`
                  : isPending
                  ? `Día ${slot.day} · hoy · +${slot.bonus} XP por reclamar`
                  : `Día ${slot.day} · futuro · +${slot.bonus} XP`
              }
              style={{
                position: "relative",
                aspectRatio: "1 / 1",
                borderRadius: 10,
                background,
                border,
                boxShadow,
                color,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                fontSize: 13,
                lineHeight: 1,
                transition: "transform 200ms ease",
                transform: isEarnedToday ? "scale(1.06)" : "none",
              }}
            >
              {(isEarnedToday || isEarned) && (
                <Check
                  className="h-3 w-3"
                  style={{ position: "absolute", top: 3, right: 3 }}
                />
              )}
              <span style={{ fontSize: 14, fontWeight: 900 }}>+{slot.bonus}</span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  opacity: 0.75,
                  marginTop: 2,
                }}
              >
                D{slot.day}
              </span>
            </div>
          )
        })}
      </div>

      {summary && (
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 12,
            fontWeight: 600,
            color: "rgba(255,255,255,0.88)",
            lineHeight: 1.4,
          }}
        >
          {summary}
        </p>
      )}
    </div>
  )
}
