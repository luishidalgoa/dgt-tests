import { describe, it, expect } from "vitest"
import {
  accessibleTests,
  pickRandom,
  randomAccessibleHref,
  type TestRef,
} from "./randomExam"
import type { UserForGate } from "@/lib/permissions"

// Usuarios de prueba en los dos extremos del gate de permisos.
const ADMIN:  UserForGate = { role: "ADMIN",      subscriptionStatus: null }
const GUEST:  UserForGate = null
const FREE:   UserForGate = { role: "USER",       subscriptionStatus: null }
const PRO:    UserForGate = { role: "SUBSCRIBER", subscriptionStatus: "active" }

const POOL: TestRef[] = [
  { slug: "permiso-b", testNumber: 1 },
  { slug: "permiso-b", testNumber: 5 },
  { slug: "permiso-b", testNumber: 20 },   // fuera del free (>7)
  { slug: "adas",      testNumber: 1 },     // categoría PRO
  { slug: "repaso-final", testNumber: 3 },  // categoría PRO
]

describe("accessibleTests", () => {
  it("admin ve todos", () => {
    expect(accessibleTests(POOL, ADMIN)).toHaveLength(POOL.length)
  })

  it("pro ve todos", () => {
    expect(accessibleTests(POOL, PRO)).toHaveLength(POOL.length)
  })

  it("free solo permiso-b 1..7", () => {
    const r = accessibleTests(POOL, FREE)
    expect(r).toEqual([
      { slug: "permiso-b", testNumber: 1 },
      { slug: "permiso-b", testNumber: 5 },
    ])
  })

  it("guest = mismo gate que free", () => {
    const r = accessibleTests(POOL, GUEST)
    expect(r.map((t) => t.testNumber)).toEqual([1, 5])
  })

  it("lista vacía → vacía", () => {
    expect(accessibleTests([], PRO)).toEqual([])
  })
})

describe("pickRandom", () => {
  it("rng=0 → primer elemento", () => {
    expect(pickRandom([10, 20, 30], () => 0)).toBe(10)
  })

  it("rng≈1 → último elemento (clamp defensivo)", () => {
    expect(pickRandom([10, 20, 30], () => 0.999999)).toBe(30)
    // incluso si rng devolviera exactamente 1, no debe salirse del array
    expect(pickRandom([10, 20, 30], () => 1)).toBe(30)
  })

  it("rng=0.5 sobre 4 elementos → índice 2", () => {
    expect(pickRandom(["a", "b", "c", "d"], () => 0.5)).toBe("c")
  })

  it("lista vacía → null", () => {
    expect(pickRandom([], () => 0)).toBeNull()
  })
})

describe("randomAccessibleHref", () => {
  it("construye el href del pick accesible", () => {
    // rng=0 → primer accesible. Para FREE el primer accesible es permiso-b/1.
    expect(randomAccessibleHref(POOL, FREE, () => 0)).toBe("/permiso-b/1")
  })

  it("free nunca recibe un test bloqueado", () => {
    // Recorremos un barrido de rng: todos los resultados deben ser
    // permiso-b con testNumber <= 7.
    for (let i = 0; i < 20; i++) {
      const href = randomAccessibleHref(POOL, FREE, () => i / 20)
      expect(href).toMatch(/^\/permiso-b\/[1-7]$/)
    }
  })

  it("pro puede recibir categorías PRO", () => {
    // rng alto → último accesible (repaso-final/3 para PRO).
    expect(randomAccessibleHref(POOL, PRO, () => 0.999999)).toBe("/repaso-final/3")
  })

  it("sin tests accesibles → null", () => {
    const onlyPro: TestRef[] = [{ slug: "adas", testNumber: 1 }]
    expect(randomAccessibleHref(onlyPro, FREE, () => 0)).toBeNull()
  })

  it("pool vacío → null", () => {
    expect(randomAccessibleHref([], PRO, () => 0)).toBeNull()
  })
})
