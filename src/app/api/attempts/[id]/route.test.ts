import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  db: {
    examAttempt: {
      findUnique: vi.fn(),
      delete:     vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}))

import { DELETE } from "@/app/api/attempts/[id]/route"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"

function deleteReq(id: string) {
  return {
    req:    new Request(`http://localhost/api/attempts/${id}`, { method: "DELETE" }),
    params: Promise.resolve({ id }),
  }
}

const adminUser  = { id: 1, username: "admin", role: "ADMIN" }
const normalUser = { id: 2, username: "luis",  role: "USER" }
const subUser    = { id: 3, username: "pro",   role: "SUBSCRIBER" }

describe("DELETE /api/attempts/[id]", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockReset()
    vi.mocked(db.examAttempt.findUnique).mockReset()
    vi.mocked(db.examAttempt.delete).mockReset()
  })

  it("401 si no hay sesión", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null as never)
    const { req, params } = deleteReq("5")
    const res = await DELETE(req, { params })
    expect(res.status).toBe(401)
    expect(db.examAttempt.delete).not.toHaveBeenCalled()
  })

  it("403 si el user no es admin", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(normalUser as never)
    const { req, params } = deleteReq("5")
    const res = await DELETE(req, { params })
    expect(res.status).toBe(403)
    expect(db.examAttempt.delete).not.toHaveBeenCalled()
  })

  it("403 si el user es SUBSCRIBER (no admin)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(subUser as never)
    const { req, params } = deleteReq("5")
    const res = await DELETE(req, { params })
    expect(res.status).toBe(403)
  })

  it("400 si el id no es un número válido", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(adminUser as never)
    const { req, params } = deleteReq("no-es-numero")
    const res = await DELETE(req, { params })
    expect(res.status).toBe(400)
    expect(db.examAttempt.delete).not.toHaveBeenCalled()
  })

  it("404 si el attempt no existe", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(adminUser as never)
    vi.mocked(db.examAttempt.findUnique).mockResolvedValue(null)
    const { req, params } = deleteReq("999")
    const res = await DELETE(req, { params })
    expect(res.status).toBe(404)
    expect(db.examAttempt.delete).not.toHaveBeenCalled()
  })

  it("403 si el attempt es de OTRO user (admin solo puede borrar los suyos)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(adminUser as never)
    vi.mocked(db.examAttempt.findUnique).mockResolvedValue({
      id: 5, userId: 999,  // ← de otro user
    } as never)
    const { req, params } = deleteReq("5")
    const res = await DELETE(req, { params })
    expect(res.status).toBe(403)
    expect(db.examAttempt.delete).not.toHaveBeenCalled()
  })

  it("200 + delete cuando es admin y el attempt es suyo", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(adminUser as never)
    vi.mocked(db.examAttempt.findUnique).mockResolvedValue({
      id: 5, userId: adminUser.id,
    } as never)
    vi.mocked(db.examAttempt.delete).mockResolvedValue({ id: 5 } as never)

    const { req, params } = deleteReq("5")
    const res = await DELETE(req, { params })
    expect(res.status).toBe(200)
    expect(db.examAttempt.delete).toHaveBeenCalledOnce()
    expect(vi.mocked(db.examAttempt.delete).mock.calls[0]?.[0]).toEqual({
      where: { id: 5 },
    })
    const body = await res.json()
    expect(body.deleted).toBe(true)
  })
})
