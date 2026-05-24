import { describe, it, expect } from "vitest"
import { splitWithHighlights } from "./ExplanationWithHighlights"

describe("splitWithHighlights", () => {
  it("subraya un substring exacto preservando el casing del texto", () => {
    const segs = splitWithHighlights(
      "El conductor debe parar en la línea.",
      ["debe parar"],
    )
    expect(segs).toEqual([
      { type: "text", value: "El conductor " },
      { type: "mark", value: "debe parar" },
      { type: "text", value: " en la línea." },
    ])
  })

  it("ignora highlights vacíos o que no aparecen", () => {
    const segs = splitWithHighlights("Texto cualquiera.", ["  ", "no aparece"])
    expect(segs).toEqual([{ type: "text", value: "Texto cualquiera." }])
  })

  it("acepta highlight con mayúsculas distintas y subraya el casing original", () => {
    // Caso real: la IA copió "Para cambiar..." como "para cambiar..." (P → p)
    const text = "Para cambiar de dirección a la IZQUIERDA en vías de sentido ÚNICO."
    const segs = splitWithHighlights(text, [
      "para cambiar de dirección a la izquierda en vías de sentido único",
    ])
    // El <mark> debe contener el casing ORIGINAL del texto, no el del highlight.
    const mark = segs.find((s) => s.type === "mark")
    expect(mark).toBeDefined()
    expect(mark!.value).toBe(
      "Para cambiar de dirección a la IZQUIERDA en vías de sentido ÚNICO"
    )
  })

  it("subraya varias frases sin solapamiento, largos primero", () => {
    const text = "Alfa y beta y alfa beta gamma."
    const segs = splitWithHighlights(text, ["alfa beta", "alfa"])
    // "alfa beta" gana sobre "alfa" en el segundo match por longitud.
    const marks = segs.filter((s) => s.type === "mark").map((s) => s.value)
    expect(marks).toContain("Alfa")     // primer "alfa" suelto (case original)
    expect(marks).toContain("alfa beta") // el grupo más largo en el segundo
  })

  it("devuelve el texto entero sin marks si no hay highlights", () => {
    const segs = splitWithHighlights("Solo texto.", [])
    expect(segs).toEqual([{ type: "text", value: "Solo texto." }])
  })
})
