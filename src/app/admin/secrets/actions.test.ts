import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  setSecretConfig: vi.fn(),
  requireAdmin:    vi.fn(),
  deleteMany:      vi.fn(),
}))

vi.mock("@/lib/adminGuard", () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock("@/lib/appConfig", () => ({ setSecretConfig: mocks.setSecretConfig }))
vi.mock("@/lib/db", () => ({
  db: { appConfig: { deleteMany: mocks.deleteMany } },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { updateSecretAction, deleteSecretAction } from "./actions"

function fd(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

describe("updateSecretAction", () => {
  beforeEach(() => {
    mocks.setSecretConfig.mockReset()
    mocks.requireAdmin.mockReset()
    mocks.requireAdmin.mockResolvedValue({ id: 1, role: "ADMIN" })
  })

  it("admin puede actualizar un secret del catálogo", async () => {
    const res = await updateSecretAction(fd({ key: "STRIPE_SECRET_KEY", value: "FAKE_KEY_x" }))
    expect(res.ok).toBe(true)
    expect(mocks.setSecretConfig).toHaveBeenCalledWith("STRIPE_SECRET_KEY", "FAKE_KEY_x", { byUserId: 1 })
  })

  it("non-admin: requireAdmin tira notFound() → action rebota", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("NEXT_NOT_FOUND"))
    await expect(updateSecretAction(fd({ key: "STRIPE_SECRET_KEY", value: "x" }))).rejects.toThrow("NEXT_NOT_FOUND")
    expect(mocks.setSecretConfig).not.toHaveBeenCalled()
  })

  it("rechaza key fuera del catálogo (whitelist)", async () => {
    const res = await updateSecretAction(fd({ key: "ARBITRARY_KEY", value: "x" }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/cat[áa]logo/i)
    expect(mocks.setSecretConfig).not.toHaveBeenCalled()
  })

  it("rechaza value vacío", async () => {
    const res = await updateSecretAction(fd({ key: "STRIPE_SECRET_KEY", value: "" }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/vac[íi]o/i)
    expect(mocks.setSecretConfig).not.toHaveBeenCalled()
  })

  it("acepta secrets con espacios (Gmail app password) y los preserva tal cual", async () => {
    const res = await updateSecretAction(fd({
      key: "GMAIL_APP_PASSWORD",
      value: "abcd efgh ijkl mnop",
    }))
    expect(res.ok).toBe(true)
    expect(mocks.setSecretConfig).toHaveBeenCalledWith("GMAIL_APP_PASSWORD", "abcd efgh ijkl mnop", { byUserId: 1 })
  })
})

describe("deleteSecretAction", () => {
  beforeEach(() => {
    mocks.deleteMany.mockReset()
    mocks.requireAdmin.mockReset()
    mocks.requireAdmin.mockResolvedValue({ id: 1, role: "ADMIN" })
  })

  it("borra el secret encrypted=true del catálogo", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 1 })
    const res = await deleteSecretAction(fd({ key: "STRIPE_SECRET_KEY" }))
    expect(res.ok).toBe(true)
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { key: "STRIPE_SECRET_KEY", encrypted: true },
    })
  })

  it("idempotente — si no había, no rompe", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 0 })
    const res = await deleteSecretAction(fd({ key: "STRIPE_SECRET_KEY" }))
    expect(res.ok).toBe(true)
  })

  it("non-admin → notFound()", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("NEXT_NOT_FOUND"))
    await expect(deleteSecretAction(fd({ key: "STRIPE_SECRET_KEY" }))).rejects.toThrow()
    expect(mocks.deleteMany).not.toHaveBeenCalled()
  })

  it("rechaza key fuera del catálogo", async () => {
    const res = await deleteSecretAction(fd({ key: "RANDOM_KEY" }))
    expect(res.ok).toBe(false)
    expect(mocks.deleteMany).not.toHaveBeenCalled()
  })
})
