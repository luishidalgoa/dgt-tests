import { describe, it, expect, vi } from "vitest"
import { isAdminUser } from "./adminGuard"

describe("isAdminUser (Fase 91 — gate de /admin)", () => {
  it("true solo si role === 'ADMIN'", () => {
    expect(isAdminUser({ id: 1, username: "x", role: "ADMIN" } as never)).toBe(true)
  })

  it("false para USER", () => {
    expect(isAdminUser({ id: 1, username: "x", role: "USER" } as never)).toBe(false)
  })

  it("false para SUBSCRIBER (¡no porque pague tiene panel admin!)", () => {
    expect(isAdminUser({ id: 1, username: "x", role: "SUBSCRIBER" } as never)).toBe(false)
  })

  it("false para null (no logueado)", () => {
    expect(isAdminUser(null)).toBe(false)
  })

  it("false para undefined", () => {
    expect(isAdminUser(undefined)).toBe(false)
  })

  it("false si falta el campo role (defensa contra usuarios malformados)", () => {
    expect(isAdminUser({ id: 1, username: "x" } as never)).toBe(false)
  })

  it("case sensitive: 'admin' (minúsculas) NO cuenta", () => {
    expect(isAdminUser({ id: 1, username: "x", role: "admin" } as never)).toBe(false)
  })
})

describe("requireAdmin", () => {
  /**
   * requireAdmin debe:
   *  - Devolver el user si es ADMIN
   *  - Llamar a notFound() si NO es admin (incluye no logueado)
   *  - notFound() NUNCA devuelve — tira un error especial de Next.js
   */
  it("devuelve el user si es ADMIN", async () => {
    vi.resetModules()
    vi.doMock("@/lib/auth", () => ({
      getCurrentUser: vi.fn().mockResolvedValue({ id: 1, username: "x", role: "ADMIN" }),
    }))
    vi.doMock("next/navigation", () => ({
      notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND") }),
    }))
    const { requireAdmin } = await import("./adminGuard")
    const user = await requireAdmin()
    expect(user.role).toBe("ADMIN")
  })

  it("llama a notFound() para SUBSCRIBER (404, no 'no autorizado')", async () => {
    vi.resetModules()
    vi.doMock("@/lib/auth", () => ({
      getCurrentUser: vi.fn().mockResolvedValue({ id: 1, username: "x", role: "SUBSCRIBER" }),
    }))
    const notFoundMock = vi.fn(() => { throw new Error("NEXT_NOT_FOUND") })
    vi.doMock("next/navigation", () => ({ notFound: notFoundMock }))
    const { requireAdmin } = await import("./adminGuard")
    await expect(requireAdmin()).rejects.toThrow("NEXT_NOT_FOUND")
    expect(notFoundMock).toHaveBeenCalledOnce()
  })

  it("llama a notFound() para USER", async () => {
    vi.resetModules()
    vi.doMock("@/lib/auth", () => ({
      getCurrentUser: vi.fn().mockResolvedValue({ id: 1, username: "x", role: "USER" }),
    }))
    const notFoundMock = vi.fn(() => { throw new Error("NEXT_NOT_FOUND") })
    vi.doMock("next/navigation", () => ({ notFound: notFoundMock }))
    const { requireAdmin } = await import("./adminGuard")
    await expect(requireAdmin()).rejects.toThrow("NEXT_NOT_FOUND")
    expect(notFoundMock).toHaveBeenCalledOnce()
  })

  it("llama a notFound() si no hay sesión (null)", async () => {
    vi.resetModules()
    vi.doMock("@/lib/auth", () => ({ getCurrentUser: vi.fn().mockResolvedValue(null) }))
    const notFoundMock = vi.fn(() => { throw new Error("NEXT_NOT_FOUND") })
    vi.doMock("next/navigation", () => ({ notFound: notFoundMock }))
    const { requireAdmin } = await import("./adminGuard")
    await expect(requireAdmin()).rejects.toThrow("NEXT_NOT_FOUND")
    expect(notFoundMock).toHaveBeenCalledOnce()
  })
})
