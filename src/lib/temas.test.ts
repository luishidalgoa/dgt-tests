import { describe, it, expect } from "vitest"
import {
  extractTemaPrefix,
  extractTemaPadre,
  extractTemaInner,
  getTemaName,
  getTemaPadreName,
  compareTemaCodes,
  classifyCodigoTema,
} from "./temas"

/**
 * Estos tests defienden el comportamiento del parser de codigoTema frente
 * a los ~50 patrones reales que tenemos en BBDD (ver inspector ad-hoc).
 *
 * El bug crítico que arreglamos: la SQL anterior usaba INSTR(codigoTema, '-')
 * para cortar el prefijo, lo cual fallaba con códigos tipo "TC 2.8 (2-8.1)"
 * (el primer guion está DENTRO del paréntesis → se cortaba en "TC 2.8 (2").
 */

describe("extractTemaPrefix", () => {
  it("extrae 'TC X.Y' de los patrones normales con guion", () => {
    expect(extractTemaPrefix("TC 1.2-5.3 (1-2.5)")).toBe("TC 1.2")
    expect(extractTemaPrefix("TC 7.3-3.1.3 (7-3.3.1) (7-3.3.1)")).toBe("TC 7.3")
    expect(extractTemaPrefix("TC 2.8-2.1 (2-8.2)")).toBe("TC 2.8")
  })

  it("extrae 'TC X' (sin subtema) cuando no hay decimal", () => {
    expect(extractTemaPrefix("TC 5-2.4 (5-2.4)")).toBe("TC 5")
    expect(extractTemaPrefix("TC 4-2.2.1 (4-2.2.1)")).toBe("TC 4")
    expect(extractTemaPrefix("TC 10-2 (10-2) (10-2)")).toBe("TC 10")
  })

  it("BUG FIX: no se confunde con guiones dentro del paréntesis", () => {
    // El bug viejo daba "TC 2.8 (2" porque INSTR cogía el guion del paréntesis.
    expect(extractTemaPrefix("TC 2.8 (2-8.1)")).toBe("TC 2.8")
    expect(extractTemaPrefix("TC 3.2 (3-2.1) (3-2.1)")).toBe("TC 3.2")
    expect(extractTemaPrefix("TC 7.3 (7-3) (7-3)")).toBe("TC 7.3")
  })

  it("ignora sufijos extraños como _ADAS", () => {
    expect(extractTemaPrefix("TC 7.3-3.4_ADAS (7-3.4)")).toBe("TC 7.3")
  })

  it("devuelve null para entradas vacías o nulas", () => {
    expect(extractTemaPrefix(null)).toBeNull()
    expect(extractTemaPrefix(undefined)).toBeNull()
    expect(extractTemaPrefix("")).toBeNull()
    expect(extractTemaPrefix("   ")).toBeNull()
  })

  it("devuelve null para entradas inválidas / huérfanas", () => {
    // En BBDD hay 4 preguntas con solo "TC" — son basura, las devolvemos
    // como null para que la UI las pueda agrupar en "otros" o ignorarlas.
    expect(extractTemaPrefix("TC")).toBeNull()
    expect(extractTemaPrefix("xyz")).toBeNull()
    expect(extractTemaPrefix("123")).toBeNull()
  })

  it("preserva los 'TC Def' (definiciones) como categoría aparte", () => {
    // Hay 16 preguntas con "TC Def-2.2 (Def-2)" etc. — son legítimas.
    expect(extractTemaPrefix("TC Def-2.2 (Def-2) (Def-2)")).toBe("TC Def")
    expect(extractTemaPrefix("TC Def-1 (Def-1) (Def-1)")).toBe("TC Def")
  })

  it("trim de espacios extra", () => {
    expect(extractTemaPrefix("  TC 1.2-5  ")).toBe("TC 1.2")
  })
})

describe("extractTemaPadre", () => {
  it("convierte 'TC X.Y' en 'TC X'", () => {
    expect(extractTemaPadre("TC 1.2")).toBe("TC 1")
    expect(extractTemaPadre("TC 7.3")).toBe("TC 7")
    expect(extractTemaPadre("TC 3.8")).toBe("TC 3")
  })

  it("deja 'TC X' tal cual cuando ya es el padre", () => {
    expect(extractTemaPadre("TC 4")).toBe("TC 4")
    expect(extractTemaPadre("TC 10")).toBe("TC 10")
  })

  it("trata 'TC Def' como su propio padre (no decimal)", () => {
    expect(extractTemaPadre("TC Def")).toBe("TC Def")
  })

  it("devuelve null para entrada nula / inválida", () => {
    expect(extractTemaPadre(null)).toBeNull()
    expect(extractTemaPadre("")).toBeNull()
    expect(extractTemaPadre("xyz")).toBeNull()
  })
})

describe("extractTemaInner", () => {
  it("devuelve la parte después del primer guion (subdivisión interna)", () => {
    expect(extractTemaInner("TC 1.2-5.3 (1-2.5)")).toBe("5.3")
    expect(extractTemaInner("TC 7.2-6 (7-2.6)")).toBe("6")
    expect(extractTemaInner("TC 4-2.2.1 (4-2.2.1)")).toBe("2.2.1")
  })

  it("normaliza sufijos como _ADAS al subcódigo limpio", () => {
    // "TC 7.3-3.4_ADAS" lo agrupamos junto con el resto de "3.4"
    expect(extractTemaInner("TC 7.3-3.4_ADAS (7-3.4)")).toBe("3.4")
  })

  it("funciona sin paréntesis", () => {
    expect(extractTemaInner("TC 1.2-5")).toBe("5")
    expect(extractTemaInner("TC 10-3.1")).toBe("3.1")
  })

  it("devuelve null cuando no hay guion (no hay subdivisión)", () => {
    expect(extractTemaInner("TC 1.2")).toBeNull()
    expect(extractTemaInner("TC 7.2(sin tail)")).toBeNull()
    expect(extractTemaInner("TC 7.3 (7-3) (7-3)")).toBeNull()
  })

  it("devuelve null para nulos / vacíos", () => {
    expect(extractTemaInner(null)).toBeNull()
    expect(extractTemaInner(undefined)).toBeNull()
    expect(extractTemaInner("")).toBeNull()
  })
})

describe("getTemaName", () => {
  it("devuelve nombres conocidos del catálogo", () => {
    expect(getTemaName("TC 1.2")).toBe("La vía")
    expect(getTemaName("TC 7.3")).toBe("Seguridad activa y pasiva")
  })

  it("hace fallback al propio código si no está en catálogo", () => {
    expect(getTemaName("TC 99.9")).toBe("TC 99.9")
  })
})

describe("getTemaPadreName", () => {
  it("devuelve el nombre del tema padre", () => {
    expect(getTemaPadreName("TC 1")).toBe("La conducción")
    expect(getTemaPadreName("TC 7")).toBe("Equipamiento del vehículo")
    expect(getTemaPadreName("TC 10")).toBe("Cuestiones administrativas")
  })

  it("hace fallback al código si no hay mapeo", () => {
    expect(getTemaPadreName("TC Def")).toBe("Definiciones")
  })
})

describe("classifyCodigoTema", () => {
  describe("tema CON subtema decimal (caso normal)", () => {
    it("clasifica 'TC 1.2-5.3' como Tema 1 / Bloque 1.2 / SubBloque 1.2.5.3", () => {
      expect(classifyCodigoTema("TC 1.2-5.3 (1-2.5)")).toEqual({
        padreCode:  "1",
        bloqueCode: "1.2",
        subCode:    "1.2.5.3",
      })
    })

    it("clasifica 'TC 7.3-3.1.3' con inner de 3 niveles", () => {
      expect(classifyCodigoTema("TC 7.3-3.1.3 (7-3.3.1)")).toEqual({
        padreCode:  "7",
        bloqueCode: "7.3",
        subCode:    "7.3.3.1.3",
      })
    })

    it("sin inner (TC 2.8 sin guion) → subCode null", () => {
      expect(classifyCodigoTema("TC 2.8 (2-8.1)")).toEqual({
        padreCode:  "2",
        bloqueCode: "2.8",
        subCode:    null,
      })
    })
  })

  describe("tema SIN subtema decimal (TC 4, TC 5, TC Def…)", () => {
    it("reagrupa 'TC 4-2.2.1' como Tema 4 / Bloque 4.2 / SubBloque 4.2.2.1", () => {
      expect(classifyCodigoTema("TC 4-2.2.1 (4-2.2.1)")).toEqual({
        padreCode:  "4",
        bloqueCode: "4.2",
        subCode:    "4.2.2.1",
      })
    })

    it("'TC 5-2.4' → Tema 5 / Bloque 5.2 / SubBloque 5.2.4", () => {
      expect(classifyCodigoTema("TC 5-2.4 (5-2.4)")).toEqual({
        padreCode:  "5",
        bloqueCode: "5.2",
        subCode:    "5.2.4",
      })
    })

    it("'TC 10-2' (inner de un solo dígito) → bloque sin subCode", () => {
      expect(classifyCodigoTema("TC 10-2 (10-2) (10-2)")).toEqual({
        padreCode:  "10",
        bloqueCode: "10.2",
        subCode:    null,
      })
    })

    it("'TC Def-2.2' → Tema Def / Bloque Def.2 / SubBloque Def.2.2", () => {
      expect(classifyCodigoTema("TC Def-2.2 (Def-2)")).toEqual({
        padreCode:  "Def",
        bloqueCode: "Def.2",
        subCode:    "Def.2.2",
      })
    })

    it("codigoTema sin guion estructural ('TC 4 (4) (4)') → bloque 4.0 huérfano", () => {
      expect(classifyCodigoTema("TC 4 (4) (4)")).toEqual({
        padreCode:  "4",
        bloqueCode: "4.0",
        subCode:    null,
      })
    })
  })

  describe("entradas inválidas", () => {
    it("devuelve null para nulos y strings sin estructura", () => {
      expect(classifyCodigoTema(null)).toBeNull()
      expect(classifyCodigoTema(undefined)).toBeNull()
      expect(classifyCodigoTema("")).toBeNull()
      expect(classifyCodigoTema("TC")).toBeNull()
      expect(classifyCodigoTema("xyz")).toBeNull()
    })
  })
})

describe("compareTemaCodes", () => {
  it("ordena los temas padre numéricamente (no alfabético)", () => {
    const arr = ["TC 10", "TC 2", "TC 1", "TC 7"]
    arr.sort(compareTemaCodes)
    expect(arr).toEqual(["TC 1", "TC 2", "TC 7", "TC 10"])
  })

  it("ordena subtemas dentro del mismo padre por su decimal", () => {
    const arr = ["TC 1.10", "TC 1.2", "TC 1.1"]
    arr.sort(compareTemaCodes)
    expect(arr).toEqual(["TC 1.1", "TC 1.2", "TC 1.10"])
  })

  it("mezcla padre+subtema correctamente", () => {
    const arr = ["TC 2.1", "TC 10", "TC 1.5", "TC 1.2", "TC 2"]
    arr.sort(compareTemaCodes)
    expect(arr).toEqual(["TC 1.2", "TC 1.5", "TC 2", "TC 2.1", "TC 10"])
  })

  it("mete 'TC Def' al final (no es un tema numerado)", () => {
    const arr = ["TC Def", "TC 5", "TC 1"]
    arr.sort(compareTemaCodes)
    expect(arr).toEqual(["TC 1", "TC 5", "TC Def"])
  })
})
