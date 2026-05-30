import { describe, it, expect } from "vitest"
import {
  buildUserPrompt,
  buildSystemPrompt,
  type StatsContext,
  type PreviousAnalysis,
} from "./aiStatsAnalysis"

const BASE_CTX: StatsContext = {
  globals: { totalAttempts: 12, totalAnswers: 360, correctAnswers: 281 },
  topWeakBlocks: [
    {
      codigoTema:  "TC 7.3",
      niveles:     "Tema 7: Señales · Bloque 7.3: Verticales",
      fallos:      14,
      respondidas: 40,
      ejemplos:    ["¿Qué indica esta señal triangular?"],
    },
  ],
}

const PREVIOUS: PreviousAnalysis = {
  generatedAt: new Date("2026-05-01T10:00:00Z"),
  globals:     { totalAttempts: 6, totalAnswers: 180, correctAnswers: 130 },
  valoracion:  "Vas por buen camino pero fallas mucho en señales verticales.",
  debilidades: [
    { tema: "Tema 7: Señales · Bloque 7.3: Verticales", fallos: 22 },
    { tema: "Tema 3: Velocidad", fallos: 9 },
  ],
}

describe("buildSystemPrompt", () => {
  it("documenta el campo progreso y la regla de comparación", () => {
    const sys = buildSystemPrompt()
    expect(sys).toContain('"progreso"')
    expect(sys).toContain("ANÁLISIS ANTERIOR")
    // Debe instruir a OMITIR progreso cuando no hay análisis previo.
    expect(sys.toLowerCase()).toContain("omite")
  })
})

describe("buildUserPrompt — sin análisis anterior", () => {
  it("no incluye la sección de comparación", () => {
    const prompt = buildUserPrompt(BASE_CTX)
    expect(prompt).not.toContain("ANÁLISIS ANTERIOR")
    expect(prompt).toContain("DATOS ACTUALES DEL ALUMNO")
    // stats actuales presentes
    expect(prompt).toContain("360")
  })
})

describe("buildUserPrompt — con análisis anterior", () => {
  const prompt = buildUserPrompt({ ...BASE_CTX, previous: PREVIOUS })

  it("incluye la sección ANÁLISIS ANTERIOR", () => {
    expect(prompt).toContain("ANÁLISIS ANTERIOR")
  })

  it("incluye las stats de entonces para que el modelo calcule el delta", () => {
    expect(prompt).toContain("180 respuestas")
    expect(prompt).toContain("130 aciertos")
  })

  it("calcula las respuestas nuevas desde el análisis previo", () => {
    // 360 actuales - 180 previas = 180 nuevas
    expect(prompt).toContain("180 preguntas nuevas")
  })

  it("incluye la valoración previa y las debilidades de entonces", () => {
    expect(prompt).toContain("buen camino")
    expect(prompt).toContain("Bloque 7.3: Verticales → 22 fallos")
    expect(prompt).toContain("Tema 3: Velocidad → 9 fallos")
  })

  it("pide explícitamente comparar para construir 'progreso'", () => {
    expect(prompt).toContain("'progreso'")
  })
})

describe("buildUserPrompt — previous con singular (1 respuesta nueva)", () => {
  it("usa singular correctamente", () => {
    const prev: PreviousAnalysis = {
      ...PREVIOUS,
      globals: { totalAttempts: 12, totalAnswers: 359, correctAnswers: 280 },
    }
    const prompt = buildUserPrompt({ ...BASE_CTX, previous: prev })
    expect(prompt).toContain("1 pregunta nueva")
    expect(prompt).not.toContain("1 preguntas nuevas")
  })
})
