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

  it("matchea cuando la IA pierde tildes (vias → vías)", () => {
    const text = "Circular por vías públicas con vehículos a motor."
    const segs = splitWithHighlights(text, ["circular por vias publicas"])
    const mark = segs.find((s) => s.type === "mark")
    expect(mark).toBeDefined()
    // Mantenemos las tildes ORIGINALES del temario en el subrayado.
    expect(mark!.value).toBe("Circular por vías públicas")
  })

  it("matchea cuando la IA añade tildes que no estaban (esta → está)", () => {
    const text = "Esta señal indica el final del tramo."
    const segs = splitWithHighlights(text, ["está señal"])
    const mark = segs.find((s) => s.type === "mark")
    expect(mark).toBeDefined()
    expect(mark!.value).toBe("Esta señal")
  })

  it("combina case + tildes (VÍAS PÚBLICAS → vias publicas)", () => {
    const text = "Se prohíbe en VÍAS PÚBLICAS sin autorización."
    const segs = splitWithHighlights(text, ["vias publicas"])
    const mark = segs.find((s) => s.type === "mark")
    expect(mark!.value).toBe("VÍAS PÚBLICAS")
  })

  // ── Whitespace tolerance (regresión #690 del banco DGT) ────────────────
  // La explicación oficial DGT viene con dobles espacios (HTML mal parseado).
  // La IA los colapsa a uno solo al copiar el substring. Antes esto rompía
  // el match porque `text.includes(phrase)` era estricto. Ahora el matcher
  // colapsa runs de whitespace en AMBOS lados antes de comparar.

  it("tolera dobles espacios en el texto original (caso real #690)", () => {
    const text = "Utilizar la  marcha más  corta posible, en las pendientes  descendentes."
    const phrase = "Utilizar la marcha más corta posible, en las pendientes descendentes."
    const segs = splitWithHighlights(text, [phrase])
    const mark = segs.find((s) => s.type === "mark")
    expect(mark).toBeDefined()
    // El mark preserva los dobles espacios del original.
    expect(mark!.value).toBe(
      "Utilizar la  marcha más  corta posible, en las pendientes  descendentes."
    )
  })

  it("tolera NBSP (U+00A0) en el texto como whitespace", () => {
    const text = "Utilizar la marcha  corta"
    const segs = splitWithHighlights(text, ["Utilizar la marcha corta"])
    const mark = segs.find((s) => s.type === "mark")
    expect(mark!.value).toBe("Utilizar la marcha  corta")
  })

  it("tolera tabs y newlines como whitespace al matchear", () => {
    const text = "frase A\nfrase B\tfrase C"
    const segs = splitWithHighlights(text, ["frase A frase B frase C"])
    const mark = segs.find((s) => s.type === "mark")
    expect(mark!.value).toBe("frase A\nfrase B\tfrase C")
  })

  it("preserva el whitespace original ALREDEDOR del match (no lo absorbe)", () => {
    const text = "antes  PALABRA  después"
    const segs = splitWithHighlights(text, ["PALABRA"])
    expect(segs).toEqual([
      { type: "text", value: "antes  " },
      { type: "mark", value: "PALABRA" },
      { type: "text", value: "  después" },
    ])
  })

  it("combina mayúsculas + tildes + dobles espacios en una sola búsqueda", () => {
    const text = "El conductor debe  reducir la  velocidad."
    const phrase = "EL CONDUCTOR DEBE REDUCIR LA VELOCIDAD"
    const segs = splitWithHighlights(text, [phrase])
    const mark = segs.find((s) => s.type === "mark")
    expect(mark).toBeDefined()
    // Sin el punto final porque la phrase no lo incluye.
    expect(mark!.value).toBe("El conductor debe  reducir la  velocidad")
  })

  it("matchea varias ocurrencias separadas por whitespace anidado", () => {
    const text = "Cuidado.  Cuidado  con la curva.  Cuidado."
    const segs = splitWithHighlights(text, ["Cuidado"])
    const marks = segs.filter((s) => s.type === "mark")
    expect(marks).toHaveLength(3)
    for (const m of marks) expect(m.value).toBe("Cuidado")
  })

  it("no matchea phrase vacía tras trim + whitespace collapse", () => {
    const segs = splitWithHighlights("texto cualquiera", ["   \n\t  "])
    expect(segs).toEqual([{ type: "text", value: "texto cualquiera" }])
  })
})
