import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock COMPLETO de @/lib/db ANTES de importar el módulo bajo test.
// Vitest hoistea automáticamente el vi.mock al top del archivo.
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      create:     vi.fn(),
    },
  },
}))

// Mock de getSession (iron-session) para que no intente leer cookies.
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(),
}))

import { normalizeUsername, normalizeEmail, authenticate, createUser, hashPassword, verifyPassword } from "@/lib/auth"
import { db } from "@/lib/db"

describe("normalizeUsername", () => {
  it("baja a minúscula y hace trim", () => {
    expect(normalizeUsername("Luisph")).toBe("luisph")
    expect(normalizeUsername("  LUIS  ")).toBe("luis")
    expect(normalizeUsername("USER.NAME-1")).toBe("user.name-1")
  })

  it("idempotente", () => {
    expect(normalizeUsername(normalizeUsername("PEPE"))).toBe("pepe")
  })
})

describe("normalizeEmail", () => {
  it("baja a minúscula y hace trim", () => {
    expect(normalizeEmail("Luis@Example.COM")).toBe("luis@example.com")
    expect(normalizeEmail("  test@foo.io  ")).toBe("test@foo.io")
  })
})

describe("hashPassword + verifyPassword", () => {
  it("roundtrip funciona", async () => {
    const hash = await hashPassword("mi_pass_123")
    expect(hash).not.toBe("mi_pass_123")
    expect(await verifyPassword("mi_pass_123", hash)).toBe(true)
  })

  it("rechaza la contraseña mal", async () => {
    const hash = await hashPassword("correcto")
    expect(await verifyPassword("INcorrecto", hash)).toBe(false)
  })
})

describe("authenticate (Fase 74 — login por email o username, case-insensitive)", () => {
  beforeEach(() => {
    vi.mocked(db.user.findUnique).mockReset()
  })

  it("busca por email cuando el identifier contiene @", async () => {
    const passwordHash = await hashPassword("pw1234")
    vi.mocked(db.user.findUnique).mockResolvedValueOnce({
      id: 1, username: "luis", email: "luis@ex.com", passwordHash,
    } as never)

    const user = await authenticate("luis@ex.com", "pw1234")
    expect(user).not.toBeNull()
    expect(vi.mocked(db.user.findUnique).mock.calls[0]?.[0]).toEqual({
      where: { email: "luis@ex.com" },
    })
  })

  it("busca por username cuando NO contiene @", async () => {
    const passwordHash = await hashPassword("pw1234")
    vi.mocked(db.user.findUnique).mockResolvedValueOnce({
      id: 1, username: "luis", email: null, passwordHash,
    } as never)

    const user = await authenticate("luis", "pw1234")
    expect(user).not.toBeNull()
    expect(vi.mocked(db.user.findUnique).mock.calls[0]?.[0]).toEqual({
      where: { username: "luis" },
    })
  })

  it("normaliza el identifier (case-insensitive)", async () => {
    const passwordHash = await hashPassword("pw1234")
    vi.mocked(db.user.findUnique).mockResolvedValueOnce({
      id: 1, username: "luis", email: null, passwordHash,
    } as never)

    await authenticate("LUIS", "pw1234")
    // Lo buscado en BBDD debe ser "luis" (minúscula), no "LUIS"
    expect(vi.mocked(db.user.findUnique).mock.calls[0]?.[0]).toEqual({
      where: { username: "luis" },
    })
  })

  it("normaliza el email a minúscula también", async () => {
    const passwordHash = await hashPassword("pw1234")
    vi.mocked(db.user.findUnique).mockResolvedValueOnce({
      id: 1, username: "luis", email: "luis@ex.com", passwordHash,
    } as never)

    await authenticate("Luis@EX.COM", "pw1234")
    expect(vi.mocked(db.user.findUnique).mock.calls[0]?.[0]).toEqual({
      where: { email: "luis@ex.com" },
    })
  })

  it("devuelve null si el user no existe", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(null)
    const user = await authenticate("noexiste", "pw")
    expect(user).toBeNull()
  })

  it("devuelve null si la contraseña no coincide", async () => {
    const passwordHash = await hashPassword("correcta")
    vi.mocked(db.user.findUnique).mockResolvedValueOnce({
      id: 1, username: "luis", email: null, passwordHash,
    } as never)

    const user = await authenticate("luis", "INcorrecta")
    expect(user).toBeNull()
  })

  it("devuelve null si el identifier está vacío", async () => {
    const user = await authenticate("   ", "pw")
    expect(user).toBeNull()
    // Y NUNCA debe haber consultado la BBDD
    expect(vi.mocked(db.user.findUnique)).not.toHaveBeenCalled()
  })
})

describe("createUser (Fase 74 — email obligatorio + validaciones)", () => {
  beforeEach(() => {
    vi.mocked(db.user.findUnique).mockReset()
    vi.mocked(db.user.create).mockReset()
  })

  it("crea el user normalizando username y email", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null)
    vi.mocked(db.user.create).mockResolvedValue({ id: 42 } as never)

    await createUser({
      username: "Luisph",
      email:    "Luis@Example.COM",
      password: "pw1234",
    })

    const args = vi.mocked(db.user.create).mock.calls[0]?.[0]
    expect((args as { data: { username: string; email: string } } | undefined)?.data.username).toBe("luisph")
    expect((args as { data: { username: string; email: string } } | undefined)?.data.email).toBe("luis@example.com")
  })

  it("rechaza username con caracteres inválidos", async () => {
    await expect(createUser({
      username: "luis@malo",  // @ no permitido
      email:    "luis@ex.com",
      password: "pw1234",
    })).rejects.toThrow(/letras|min.*scula/i)
  })

  it("rechaza username de menos de 3 chars", async () => {
    await expect(createUser({
      username: "lu",
      email:    "luis@ex.com",
      password: "pw1234",
    })).rejects.toThrow(/3 caracteres/i)
  })

  it("rechaza password de menos de 6 chars", async () => {
    await expect(createUser({
      username: "luis",
      email:    "luis@ex.com",
      password: "pw12",
    })).rejects.toThrow(/6 caracteres/i)
  })

  it("rechaza email sin @", async () => {
    await expect(createUser({
      username: "luis",
      email:    "noesemail",
      password: "pw1234",
    })).rejects.toThrow(/email/i)
  })

  it("rechaza si el username ya existe", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValueOnce({ id: 99 } as never)
    await expect(createUser({
      username: "luis",
      email:    "luis@ex.com",
      password: "pw1234",
    })).rejects.toThrow(/usuario.*uso/i)
  })

  it("rechaza si el email ya existe", async () => {
    vi.mocked(db.user.findUnique)
      .mockResolvedValueOnce(null)                  // username libre
      .mockResolvedValueOnce({ id: 99 } as never)   // email ocupado
    await expect(createUser({
      username: "luis",
      email:    "luis@ex.com",
      password: "pw1234",
    })).rejects.toThrow(/email.*asociado/i)
  })
})
