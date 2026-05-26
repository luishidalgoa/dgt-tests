"use client"

import { useState } from "react"
import { StreakIcon } from "./StreakIcon"
import { LEVELS } from "@/lib/xpLevels"
import { Flame, X } from "lucide-react"

/**
 * Panel flotante (solo admin + solo desktop) para inspeccionar todos los
 * iconos de racha en sus 3 estados (active / frozen / dormant).
 *
 * Botón fijo en esquina inferior izquierda. Click → modal grid con
 * `niveles × estados` y meta info (nivel, label, asset path).
 *
 * Visible SOLO en viewports ≥ 1024px — en mobile no se renderiza nada
 * (CSS @media en el style block).
 */

const STATES: Array<{ key: "active" | "frozen" | "dormant"; label: string; description: string }> = [
  { key: "active",  label: "Active",  description: "Racha viva — el user ha hecho algo hoy" },
  { key: "frozen",  label: "Frozen",  description: "Tenía racha pero hoy aún no se ha hecho nada" },
  { key: "dormant", label: "Dormant", description: "Sin racha activa (siempre lvl 0)" },
]

export function StreakDebugPanel() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        .streak-debug-fab { display: none; }
        @media (min-width: 1024px) {
          .streak-debug-fab {
            display: inline-flex; align-items: center; gap: 8px;
            position: fixed; bottom: 20px; left: 20px;
            z-index: 140;
            padding: 9px 16px;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            color: #fff;
            border-radius: 999px;
            font-size: 12.5px; font-weight: 800; letter-spacing: 0.02em;
            box-shadow: 0 12px 24px -10px rgba(99, 102, 241, 0.55);
            cursor: pointer; user-select: none; border: 0;
            transition: transform 0.15s;
          }
          .streak-debug-fab:hover { transform: translateY(-2px); }
        }
      `}} />

      <button
        type="button"
        className="streak-debug-fab"
        onClick={() => setOpen(true)}
        aria-label="Debug: abrir inspector de iconos de racha"
        title="Solo visible para admins · inspector de iconos de racha"
      >
        <Flame className="h-3.5 w-3.5" />
        Streak debug
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Inspector de iconos de racha"
          style={{
            position:       "fixed",
            inset:          0,
            background:     "rgba(15, 23, 42, 0.55)",
            backdropFilter: "blur(3px)",
            zIndex:         500,
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            padding:        24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background:    "#fff",
              borderRadius:  14,
              maxWidth:      980,
              width:         "100%",
              maxHeight:     "88vh",
              overflow:      "auto",
              boxShadow:     "0 30px 80px rgba(0,0,0,0.4)",
            }}
          >
            <header style={{
              display:        "flex",
              alignItems:     "center",
              justifyContent: "space-between",
              padding:        "16px 22px",
              borderBottom:   "1px solid var(--slate-200)",
              background:     "var(--slate-50, #f8fafc)",
              position:       "sticky",
              top:            0,
              zIndex:         1,
            }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
                  🔥 Streak icons debug
                </h2>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--slate-500)" }}>
                  {LEVELS.length} niveles × {STATES.length} estados — todos los iconos en una vista
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                style={{
                  border: 0, background: "transparent", padding: 8,
                  cursor: "pointer", color: "var(--slate-600)",
                  borderRadius: 8,
                  display: "inline-flex",
                }}
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--slate-100, #f1f5f9)" }}>
                  <th style={cellHeadStyle}>Nivel</th>
                  <th style={cellHeadStyle}>Label · XP min</th>
                  {STATES.map((s) => (
                    <th key={s.key} style={cellHeadStyle} title={s.description}>
                      {s.label}
                    </th>
                  ))}
                  <th style={cellHeadStyle}>Asset paths</th>
                </tr>
              </thead>
              <tbody>
                {LEVELS.map((lvl) => (
                  <tr key={lvl.level} style={{ borderTop: "1px solid var(--slate-100)" }}>
                    <td style={cellNumStyle}>{lvl.level}</td>
                    <td style={cellStyle}>
                      <div style={{ fontWeight: 700 }}>{lvl.label}</div>
                      <div style={{ color: "var(--slate-500)", fontSize: 11 }}>
                        {lvl.minXp} XP
                      </div>
                    </td>
                    {STATES.map((s) => (
                      <td key={s.key} style={{ ...cellStyle, textAlign: "center" }}>
                        <div style={{
                          display:        "inline-flex",
                          flexDirection:  "column",
                          alignItems:     "center",
                          gap:            4,
                          padding:        10,
                          borderRadius:   10,
                          background:     "var(--slate-50, #f8fafc)",
                          border:         "1px solid var(--slate-200)",
                        }}>
                          {/* Forzamos xp al minXp del nivel para que getLevel devuelva exactamente este nivel.
                              Si state="dormant" el StreakIcon ignora xp y muestra nivel 0. */}
                          <StreakIcon
                            xp={lvl.minXp}
                            state={s.key}
                            size={64}
                          />
                          <span style={{ fontSize: 10, color: "var(--slate-500)" }}>
                            {s.key}
                          </span>
                        </div>
                      </td>
                    ))}
                    <td style={{ ...cellStyle, fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--slate-600)" }}>
                      <div>{lvl.iconPath}</div>
                      <div style={{ color: lvl.frozenIconPath ? "var(--slate-600)" : "var(--orange-600)" }}>
                        {lvl.frozenIconPath ?? "(sin asset freeze → fallback CSS)"}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <footer style={{
              padding:    "12px 22px",
              borderTop:  "1px solid var(--slate-200)",
              background: "var(--slate-50, #f8fafc)",
              fontSize:   11.5,
              color:      "var(--slate-600)",
            }}>
              Las animaciones (<code>StreakLevelEffect</code>) solo se aplican en estado <b>active</b>.
              Frozen y dormant son visualmente apagados a propósito.
            </footer>
          </div>
        </div>
      )}
    </>
  )
}

const cellHeadStyle: React.CSSProperties = {
  padding:        "10px 12px",
  textAlign:      "left",
  fontWeight:     700,
  fontSize:       11,
  color:          "var(--slate-600)",
  textTransform:  "uppercase",
  letterSpacing:  "0.04em",
}
const cellStyle: React.CSSProperties = {
  padding: "12px",
  verticalAlign: "middle",
}
const cellNumStyle: React.CSSProperties = {
  ...cellStyle,
  fontFamily: "var(--font-mono)",
  fontSize:   16,
  fontWeight: 800,
  color:      "var(--slate-700)",
  textAlign:  "center",
  width:      50,
}
