import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.hoisted permite usar las vars dentro de las factory de vi.mock
const mocks = vi.hoisted(() => ({
  setConfig:    vi.fn(),
  requireAdmin: vi.fn(),
}))

vi.mock("@/lib/adminGuard", () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock("@/lib/appConfig", () => ({ setConfig: mocks.setConfig }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { updateConfigAction } from "./actions"

const setConfigMock = mocks.setConfig
const requireAdminMock = mocks.requireAdmin

function fd(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

describe("updateConfigAction (Server Action /admin)", () => {
  beforeEach(() => {
    setConfigMock.mockReset()
    requireAdminMock.mockReset()
    requireAdminMock.mockResolvedValue({ id: 1, username: "admin", role: "ADMIN" })
  })

  it("admin puede actualizar AI_TOKENS_PRO con número válido", async () => {
    const res = await updateConfigAction(fd({ key: "AI_TOKENS_PRO", value: "100" }))
    expect(res.ok).toBe(true)
    expect(setConfigMock).toHaveBeenCalledWith("AI_TOKENS_PRO", 100, { byUserId: 1 })
  })

  it("non-admin: requireAdmin tira notFound() → Server Action rebota la excepción", async () => {
    requireAdminMock.mockRejectedValue(new Error("NEXT_NOT_FOUND"))
    await expect(updateConfigAction(fd({ key: "AI_TOKENS_PRO", value: "100" }))).rejects.toThrow("NEXT_NOT_FOUND")
    expect(setConfigMock).not.toHaveBeenCalled()
  })

  it("rechaza key que no está en el catálogo (whitelist)", async () => {
    const res = await updateConfigAction(fd({ key: "ARBITRARY_KEY", value: "x" }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/cat[áa]logo/i)
    expect(setConfigMock).not.toHaveBeenCalled()
  })

  it("rechaza number no parseable", async () => {
    const res = await updateConfigAction(fd({ key: "AI_TOKENS_PRO", value: "abc" }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/n[úu]mero/i)
    expect(setConfigMock).not.toHaveBeenCalled()
  })

  it("boolean: 'on' / 'true' / cualquier truthy → true", async () => {
    await updateConfigAction(fd({ key: "MAINTENANCE_MODE", value: "on" }))
    expect(setConfigMock).toHaveBeenLastCalledWith("MAINTENANCE_MODE", true, { byUserId: 1 })

    await updateConfigAction(fd({ key: "MAINTENANCE_MODE", value: "true" }))
    expect(setConfigMock).toHaveBeenLastCalledWith("MAINTENANCE_MODE", true, { byUserId: 1 })
  })

  it("boolean: 'off' / 'false' / vacío / null → false", async () => {
    await updateConfigAction(fd({ key: "MAINTENANCE_MODE", value: "off" }))
    expect(setConfigMock).toHaveBeenLastCalledWith("MAINTENANCE_MODE", false, { byUserId: 1 })

    await updateConfigAction(fd({ key: "MAINTENANCE_MODE", value: "false" }))
    expect(setConfigMock).toHaveBeenLastCalledWith("MAINTENANCE_MODE", false, { byUserId: 1 })

    await updateConfigAction(fd({ key: "MAINTENANCE_MODE", value: "" }))
    expect(setConfigMock).toHaveBeenLastCalledWith("MAINTENANCE_MODE", false, { byUserId: 1 })
  })

  it("string: acepta cualquier texto incluido vacío", async () => {
    await updateConfigAction(fd({ key: "WELCOME_MESSAGE", value: "Hola mundo" }))
    expect(setConfigMock).toHaveBeenLastCalledWith("WELCOME_MESSAGE", "Hola mundo", { byUserId: 1 })

    await updateConfigAction(fd({ key: "WELCOME_MESSAGE", value: "" }))
    expect(setConfigMock).toHaveBeenLastCalledWith("WELCOME_MESSAGE", "", { byUserId: 1 })
  })

  it("rechaza si key no es string (form malformado)", async () => {
    // FormData con file (Blob) en lugar de string
    const f = new FormData()
    f.set("key", new Blob(["x"]), "f.txt")
    f.set("value", "100")
    const res = await updateConfigAction(f)
    expect(res.ok).toBe(false)
  })
})
