"use client"

import { useState } from "react"
import { CheckCircle2, XCircle, Lightbulb, RotateCw } from "lucide-react"

interface OptionView {
  id:        number
  letra:     string
  texto:     string
  isCorrect: boolean
}

interface Props {
  options:     OptionView[]
  explicacion: string
}

/**
 * Versión interactiva de una pregunta individual (/preguntas/[cat]/[slug]).
 *
 * Antes el servidor renderizaba TODO de golpe — la respuesta correcta
 * destacada en verde y la explicación visible. El visitante no tenía
 * incentivo para "responder", solo leía. UX pobre.
 *
 * Ahora:
 *  1. Server renderiza las 3 opciones en estado neutro (sin marcador
 *     de cuál es correcta).
 *  2. Usuario clica una → el estado revela:
 *       - badge "¡Correcto!" o "Incorrecto, era la X"
 *       - markers verde/rojo en las opciones
 *       - bloque de explicación
 *       - botón "Intentar otra vez" (resetea estado)
 *
 * SEO: la respuesta correcta + explicación viven en el JSON-LD
 * (Question schema con acceptedAnswer) del server component padre.
 * Google no necesita interactuar para indexar el contenido — ya lo
 * tiene en el schema. Lo que ve en body es la pregunta + opciones
 * (texto indexable), que es lo crítico para rankear queries
 * textuales tipo "puede un coche llevar solamente el espejo...".
 */
export function InteractiveQuestion({ options, explicacion }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const revealed       = selectedId !== null
  const selectedOption = options.find((o) => o.id === selectedId)
  const correctOption  = options.find((o) => o.isCorrect)
  const userIsCorrect  = revealed && selectedOption?.isCorrect === true

  return (
    <>
      {/* OPCIONES */}
      <section style={{ marginBottom: 18 }}>
        <h2
          style={{
            fontSize:      11,
            fontWeight:    800,
            color:         "var(--slate-500)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            margin:        "0 0 10px",
          }}
        >
          {revealed ? "Resultado" : "Elige una respuesta"}
        </h2>
        <div role="radiogroup" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {options.map((opt) => {
            const isSelected   = opt.id === selectedId
            const showCorrect  = revealed && opt.isCorrect
            const showWrong    = revealed && isSelected && !opt.isCorrect
            const border = showCorrect
              ? "2px solid var(--green)"
              : showWrong
              ? "2px solid var(--red-500)"
              : "1.5px solid var(--slate-200)"
            const background = showCorrect
              ? "rgba(34, 197, 94, 0.06)"
              : showWrong
              ? "rgba(239, 68, 68, 0.06)"
              : "#fff"

            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => {
                  if (!revealed) setSelectedId(opt.id)
                }}
                style={{
                  display:      "flex",
                  alignItems:   "flex-start",
                  gap:          12,
                  padding:      "12px 14px",
                  borderRadius: 12,
                  border,
                  background,
                  cursor:       revealed ? "default" : "pointer",
                  textAlign:    "left",
                  width:        "100%",
                  font:         "inherit",
                  color:        "inherit",
                  opacity:      1,  // override default disabled styling si lo añadimos
                  transition:   "background 0.15s, border-color 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (!revealed) {
                    e.currentTarget.style.background = "rgba(148, 163, 184, 0.05)"
                  }
                }}
                onMouseLeave={(e) => {
                  if (!revealed) {
                    e.currentTarget.style.background = "#fff"
                  }
                }}
              >
                <span
                  style={{
                    flexShrink:     0,
                    width:          30,
                    height:         30,
                    borderRadius:   "50%",
                    background:     showCorrect
                      ? "var(--green)"
                      : showWrong
                      ? "var(--red-500)"
                      : "var(--slate-100)",
                    color:          (showCorrect || showWrong) ? "#fff" : "var(--slate-600)",
                    fontWeight:     800,
                    fontSize:       13,
                    display:        "inline-flex",
                    alignItems:     "center",
                    justifyContent: "center",
                  }}
                >
                  {opt.letra}
                </span>
                <span style={{ flex: 1, fontSize: 14.5, lineHeight: 1.55 }}>
                  {opt.texto}
                </span>
                {showCorrect && (
                  <CheckCircle2 className="h-5 w-5 flex-shrink-0" style={{ color: "var(--green)", marginTop: 2 }} />
                )}
                {showWrong && (
                  <XCircle className="h-5 w-5 flex-shrink-0" style={{ color: "var(--red-500)", marginTop: 2 }} />
                )}
              </button>
            )
          })}
        </div>
      </section>

      {/* RESULTADO + EXPLICACIÓN — solo tras click */}
      {revealed && (
        <>
          <section
            role="status"
            aria-live="polite"
            style={{
              padding:      14,
              marginBottom: 14,
              borderRadius: 12,
              border:       userIsCorrect
                ? "1.5px solid var(--green)"
                : "1.5px solid var(--red-500)",
              background:   userIsCorrect
                ? "rgba(34, 197, 94, 0.06)"
                : "rgba(239, 68, 68, 0.06)",
              color:        userIsCorrect ? "var(--green-d, #15803d)" : "var(--red-700, #b91c1c)",
              fontWeight:   700,
              fontSize:     14.5,
              display:      "flex",
              alignItems:   "center",
              gap:          10,
            }}
          >
            {userIsCorrect ? (
              <>
                <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
                <span>¡Correcto!</span>
              </>
            ) : (
              <>
                <XCircle className="h-5 w-5 flex-shrink-0" />
                <span>
                  Incorrecto. La respuesta correcta es la{" "}
                  <b>{correctOption?.letra}</b>.
                </span>
              </>
            )}
          </section>

          <section
            className="card-soft"
            style={{
              padding:     16,
              marginBottom: 14,
              background:  "rgba(245, 158, 11, 0.06)",
              borderColor: "rgba(245, 158, 11, 0.25)",
            }}
          >
            <div
              style={{
                display:       "inline-flex",
                alignItems:    "center",
                gap:           8,
                fontSize:      12.5,
                fontWeight:    800,
                color:         "var(--amber-d, #92400e)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom:  8,
              }}
            >
              <Lightbulb className="h-4 w-4" />
              Explicación
            </div>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.65, color: "var(--slate-700)" }}>
              {explicacion}
            </p>
          </section>

          <button
            type="button"
            onClick={() => setSelectedId(null)}
            style={{
              display:      "inline-flex",
              alignItems:   "center",
              gap:          6,
              padding:      "8px 14px",
              borderRadius: 8,
              border:       "1.5px solid var(--slate-200)",
              background:   "#fff",
              color:        "var(--slate-700)",
              fontWeight:   700,
              fontSize:     13,
              cursor:       "pointer",
            }}
          >
            <RotateCw className="h-3.5 w-3.5" />
            Intentar otra vez
          </button>
        </>
      )}
    </>
  )
}
