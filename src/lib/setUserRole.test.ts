import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  parseRoleArg,
  setUserRole,
  VALID_ROLES,
  type Role,
  type UserRoleDb,
} from "./setUserRole"

describe("parseRoleArg", () => {
  it("normaliza a mayúsculas", () => {
    expect(parseRoleArg("admin")).toEqual({ role: "ADMIN" })
    expect(parseRoleArg("user")).toEqual({ role: "USER" })
    expect(parseRoleArg("Subscriber")).toEqual({ role: "SUBSCRIBER" })
  })

  it("acepta los 3 roles válidos", () => {
    for (const r of VALID_ROLES) {
      expect(parseRoleArg(r)).toEqual({ role: r })
    }
  })

  it("rechaza roles inválidos", () => {
    expect(parseRoleArg("SUPER")).toEqual({
      error: expect.stringMatching(/Rol inválido/),
    })
    expect(parseRoleArg("")).toEqual({
      error: expect.stringMatching(/Rol inválido/),
    })
  })
})

describe("setUserRole", () => {
  let mockDb: UserRoleDb

  beforeEach(() => {
    mockDb = {
      user: {
        findUnique: vi.fn(),
        update:     vi.fn(),
      },
    }
  })

  it("actualiza el role del user encontrado", async () => {
    vi.mocked(mockDb.user.findUnique).mockResolvedValue({ id: 1, username: "luis", role: "USER" })
    vi.mocked(mockDb.user.update).mockResolvedValue({ id: 1, username: "luis", role: "ADMIN" })

    const result = await setUserRole(mockDb, "luis", "ADMIN")
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.user.role).toBe("ADMIN")
    }
    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { username: "luis" },
      data:  { role: "ADMIN" },
    })
  })

  it("devuelve error si el user no existe", async () => {
    vi.mocked(mockDb.user.findUnique).mockResolvedValue(null)

    const result = await setUserRole(mockDb, "noexiste", "ADMIN")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/No existe el usuario/)
    }
    expect(mockDb.user.update).not.toHaveBeenCalled()
  })

  it("rechaza role inválido sin tocar la BBDD", async () => {
    const result = await setUserRole(mockDb, "luis", "SUPERADMIN" as Role)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/Rol inválido/)
    }
    expect(mockDb.user.findUnique).not.toHaveBeenCalled()
    expect(mockDb.user.update).not.toHaveBeenCalled()
  })

  it("acepta role en minúsculas también (defensa double-check)", async () => {
    vi.mocked(mockDb.user.findUnique).mockResolvedValue({ id: 1, username: "luis", role: "USER" })
    vi.mocked(mockDb.user.update).mockResolvedValue({ id: 1, username: "luis", role: "ADMIN" })

    // Aunque el CLI normaliza con parseRoleArg, setUserRole acepta
    // 'admin' lowercase porque internamente vuelve a llamar a parseRoleArg.
    const result = await setUserRole(mockDb, "luis", "admin" as Role)
    expect(result.ok).toBe(true)
  })
})
