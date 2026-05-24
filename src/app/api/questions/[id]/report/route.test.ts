import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  getCurrentUser:        vi.fn(),
  questionFindUnique:    vi.fn(),
  questionReportCreate:  vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock("@/lib/db", () => ({
  db: {
    question:       { findUnique: mocks.questionFindUnique },
    questionReport: { create:     mocks.questionReportCreate },
  },
}))

import { POST } from "./route"

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/questions/1/report", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  })
}

const wrapParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe("POST /api/questions/[id]/report", () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockReset()
    mocks.questionFindUnique.mockReset()
    mocks.questionReportCreate.mockReset()
    mocks.questionFindUnique.mockResolvedValue({ id: 1 })
    mocks.questionReportCreate.mockResolvedValue({ id: 99 })
  })

  it("usuario logueado: crea report con userId, ignora guestEmail si llega", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 42, username: "ada" })
    const res = await POST(
      makeReq({ type: "wrong_answer", comment: "La B también es correcta", guestEmail: "spy@x.com" }),
      wrapParams("1"),
    )
    expect(res.status).toBe(201)
    expect(mocks.questionReportCreate).toHaveBeenCalledTimes(1)
    const arg = mocks.questionReportCreate.mock.calls[0][0]
    expect(arg.data).toEqual({
      questionId: 1,
      userId:     42,
      guestEmail: null,
      type:       "wrong_answer",
      comment:    "La B también es correcta",
    })
  })

  it("guest con email: guarda guestEmail y userId=null", async () => {
    mocks.getCurrentUser.mockResolvedValue(null)
    const res = await POST(
      makeReq({ type: "broken_image", guestEmail: "guest@example.com" }),
      wrapParams("1"),
    )
    expect(res.status).toBe(201)
    expect(mocks.questionReportCreate.mock.calls[0][0].data).toMatchObject({
      userId:     null,
      guestEmail: "guest@example.com",
      comment:    null,
    })
  })

  it("guest sin email: ambos NULL", async () => {
    mocks.getCurrentUser.mockResolvedValue(null)
    const res = await POST(makeReq({ type: "other" }), wrapParams("1"))
    expect(res.status).toBe(201)
    expect(mocks.questionReportCreate.mock.calls[0][0].data).toMatchObject({
      userId:     null,
      guestEmail: null,
    })
  })

  it("type inválido → 400 y no toca BBDD", async () => {
    mocks.getCurrentUser.mockResolvedValue(null)
    const res = await POST(makeReq({ type: "hack" }), wrapParams("1"))
    expect(res.status).toBe(400)
    expect(mocks.questionReportCreate).not.toHaveBeenCalled()
  })

  it("id no numérico → 400 sin tocar BBDD", async () => {
    mocks.getCurrentUser.mockResolvedValue(null)
    const res = await POST(makeReq({ type: "other" }), wrapParams("abc"))
    expect(res.status).toBe(400)
    expect(mocks.questionFindUnique).not.toHaveBeenCalled()
  })

  it("pregunta no existe → 404", async () => {
    mocks.questionFindUnique.mockResolvedValue(null)
    mocks.getCurrentUser.mockResolvedValue(null)
    const res = await POST(makeReq({ type: "other" }), wrapParams("999"))
    expect(res.status).toBe(404)
    expect(mocks.questionReportCreate).not.toHaveBeenCalled()
  })

  it("comment trim → string vacío se guarda como null", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 7 })
    await POST(makeReq({ type: "other", comment: "   " }), wrapParams("1"))
    expect(mocks.questionReportCreate.mock.calls[0][0].data.comment).toBeNull()
  })

  it("rechaza comment > 1000 chars", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 7 })
    const res = await POST(
      makeReq({ type: "other", comment: "x".repeat(1001) }),
      wrapParams("1"),
    )
    expect(res.status).toBe(400)
    expect(mocks.questionReportCreate).not.toHaveBeenCalled()
  })

  it("rechaza guestEmail no válido", async () => {
    mocks.getCurrentUser.mockResolvedValue(null)
    const res = await POST(
      makeReq({ type: "other", guestEmail: "notanemail" }),
      wrapParams("1"),
    )
    expect(res.status).toBe(400)
  })

  it("acepta guestEmail vacío (string vacío == sin email)", async () => {
    mocks.getCurrentUser.mockResolvedValue(null)
    const res = await POST(
      makeReq({ type: "other", guestEmail: "" }),
      wrapParams("1"),
    )
    expect(res.status).toBe(201)
    expect(mocks.questionReportCreate.mock.calls[0][0].data.guestEmail).toBeNull()
  })
})
