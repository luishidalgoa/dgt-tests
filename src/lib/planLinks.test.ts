import { describe, it, expect } from "vitest"
import { getPlanHref, getPlanBadgeMeta } from "./planLinks"

describe("getPlanHref", () => {
  it("ADMIN → /admin (Recomendado)", () => {
    expect(getPlanHref("ADMIN")).toBe("/admin")
  })

  it("FREE → /upgrade (mantenemos el comportamiento previo)", () => {
    expect(getPlanHref("FREE")).toBe("/upgrade")
  })

  it("PRO → null (no clicable — su gestión vive en /settings)", () => {
    expect(getPlanHref("PRO")).toBeNull()
  })
})

describe("getPlanBadgeMeta", () => {
  it("ADMIN: tooltip menciona el panel admin", () => {
    const meta = getPlanBadgeMeta("ADMIN")
    expect(meta.href).toBe("/admin")
    expect(meta.title).toMatch(/admin/i)
  })

  it("PRO: tooltip describe suscripción activa, sin href", () => {
    const meta = getPlanBadgeMeta("PRO")
    expect(meta.href).toBeNull()
    expect(meta.title).toMatch(/PRO/i)
  })

  it("FREE: tooltip invita a mejorar, href /upgrade", () => {
    const meta = getPlanBadgeMeta("FREE")
    expect(meta.href).toBe("/upgrade")
    expect(meta.title).toMatch(/mejorar/i)
  })
})
