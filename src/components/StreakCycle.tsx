import { buildCycleView, STREAK_DAY_BONUSES, type StreakStateKind } from "@/lib/xp"
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
 *   - earned         : naranja sólido con check ✓.
 *   - today + earned : gradient naranja vivo + glow (lo recién cobrado).
 *   - today          : outline naranja dashed ("si juegas hoy ganas X").
 *   - upcoming       : gris claro, valor atenuado.
 *
 * Pintado SIEMPRE sobre fondo claro (`.dash-streak` = #fff). Si se
 * monta sobre fondo oscuro habría que duplicar la paleta — preferí
 * mantener una sola sintonizada al sitio real donde vive.
 *
 * 100% server-side: recibe el estado pre-computado desde el dashboard.
 */
export function StreakCycle({ state, days, claimedToday }: StreakCycleProps) {
  const slots = buildCycleView({ state, days, claimedToday })

  // Posición en el ciclo para el header. days=0 → "0/7" (aún sin
  // empezar). days=7 → "7/7". days=8 → "1/7" (segundo ciclo). El
  // bug "-1/7" anterior venía de usar `Math.min` con números negativos.
  const dayInCycle = days > 0
    ? ((days - 1) % STREAK_DAY_BONUSES.length) + 1
    : 0

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
        return `Racha congelada. Haz un test hoy para reclamar +${todaySlot.bonus} XP`
      }
      // Ciclo entero ganado pero hoy no se ha jugado — mañana arranca uno nuevo.
      return "Racha congelada. Ciclo completado — mañana empieza uno nuevo"
    }
    return "Empieza una racha hoy y consigue +5 XP de bonus"
  })()

  return (
    <div style={{ marginTop: 4 }}>
      <div
        style={{
          fontSize:       11,
          fontWeight:     800,
          color:          "var(--slate-500)",
          textTransform:  "uppercase",
          letterSpacing:  "0.08em",
          marginBottom:   8,
          display:        "flex",
          alignItems:     "center",
          gap:            6,
        }}
      >
        {state === "frozen" && (
          <Snowflake
            className="h-3.5 w-3.5"
            style={{ color: "#0ea5e9" }}
            aria-hidden="true"
          />
        )}
        Ciclo de racha · {dayInCycle}/7
      </div>

      <div
        style={{
          display:             "grid",
          // 7 columnas iguales con `minmax(0, 1fr)` para que los chips
          // colapsen sin desbordar en móviles estrechos. El gap es
          // mínimo (4px) para preservar ancho útil a 320-375px.
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap:                 4,
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

          // Default: upcoming (fondo gris claro, texto slate-400).
          let background = "var(--slate-100)"
          let color      = "var(--slate-400)"
          let border     = "1px solid var(--slate-200)"
          let boxShadow  = "none"

          if (isEarnedToday) {
            // Hoy + ya cobrado: gradient naranja vivo con glow.
            background = "linear-gradient(180deg, #fb923c, var(--orange-600))"
            color      = "#fff"
            border     = "1px solid rgba(234, 88, 12, 0.6)"
            boxShadow  = "0 6px 14px -6px rgba(234, 88, 12, 0.55), 0 0 0 3px rgba(249, 115, 22, 0.18)"
          } else if (isEarned) {
            // Pasado de este ciclo: naranja sólido apagado.
            background = "linear-gradient(180deg, #fdba74, #fb923c)"
            color      = "#fff"
            border     = "1px solid rgba(249, 115, 22, 0.45)"
            boxShadow  = "0 4px 10px -8px rgba(234, 88, 12, 0.5)"
          } else if (isPending) {
            // Hoy pendiente: outline naranja dashed sobre fondo blanco.
            background = "#fff"
            color      = "var(--orange-600)"
            border     = "2px dashed var(--orange-500)"
            boxShadow  = "0 0 0 3px rgba(249, 115, 22, 0.10)"
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
                position:       "relative",
                // Sin aspectRatio fijo: la altura se basa en padding +
                // contenido, así no se aprietan los textos en móvil.
                minHeight:      56,
                padding:        "8px 4px 6px",
                borderRadius:   10,
                background,
                border,
                boxShadow,
                color,
                display:        "flex",
                flexDirection:  "column",
                alignItems:     "center",
                justifyContent: "center",
                fontWeight:     800,
                lineHeight:     1,
                transition:     "transform 200ms ease",
                transform:      isEarnedToday ? "scale(1.06)" : "none",
                // Asegura que no se desborden los chips estrechos.
                minWidth:       0,
                overflow:       "hidden",
              }}
            >
              {(isEarnedToday || isEarned) && (
                <Check
                  className="h-3 w-3"
                  style={{ position: "absolute", top: 3, right: 3 }}
                  aria-hidden="true"
                />
              )}
              <span
                style={{
                  // clamp: 12px en móvil estrecho, 14px en escritorio.
                  fontSize:   "clamp(12px, 2.2vw, 14px)",
                  fontWeight: 900,
                }}
              >
                +{slot.bonus}
              </span>
              <span
                style={{
                  fontSize:       "clamp(8.5px, 1.4vw, 9.5px)",
                  fontWeight:     700,
                  letterSpacing:  "0.05em",
                  textTransform:  "uppercase",
                  opacity:        0.7,
                  marginTop:      3,
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
            margin:     "10px 0 0",
            fontSize:   12.5,
            fontWeight: 600,
            color:      state === "frozen" ? "#0369a1" : "var(--slate-500)",
            lineHeight: 1.4,
          }}
        >
          {summary}
        </p>
      )}
    </div>
  )
}
