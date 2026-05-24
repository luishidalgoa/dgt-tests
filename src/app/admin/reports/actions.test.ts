import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAdmin:      vi.fn(),
  reportUpdate:      vi.fn(),
  reportUpdateMany:  vi.fn(),
}))

vi.mock("@/lib/adminGuard", () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock("@/lib/db", () => ({
  db: {
    questionReport: {
      update:     mocks.reportUpdate,
      updateMany: mocks.reportUpdateMany,
    },
  },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { updateReportStatusAction, bulkUpdateReportsForQuestionAction } from "./actions"

function fd(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

describe("updateReportStatusAction", () => {
  beforeEach(() => {
    mocks.requireAdmin.mockReset()
    mocks.reportUpdate.mockReset()
    mocks.requireAdmin.mockResolvedValue({ id: 1, username: "admin", role: "ADMIN" })
    mocks.reportUpdate.mockResolvedValue({ id: 42 })
  })

  it("admin marca como reviewed → status + reviewedAt + reviewedBy", async () => {
    const res = await updateReportStatusAction(fd({ id: "42", status: "reviewed" }))
    expect(res.ok).toBe(true)
    const arg = mocks.reportUpdate.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 42 })
    expect(arg.data.status).toBe("reviewed")
    expect(arg.data.reviewedAt).toBeInstanceOf(Date)
    expect(arg.data.reviewedBy).toBe(1)
  })

  it("admin marca como fixed → idem reviewed", async () => {
    const res = await updateReportStatusAction(fd({ id: "1", status: "fixed" }))
    expect(res.ok).toBe(true)
    expect(mocks.reportUpdate.mock.calls[0][0].data.status).toBe("fixed")
  })

  it("admin marca como dismissed → idem", async () => {
    const res = await updateReportStatusAction(fd({ id: "1", status: "dismissed" }))
    expect(res.ok).toBe(true)
    expect(mocks.reportUpdate.mock.calls[0][0].data.status).toBe("dismissed")
  })

  it("reabrir a pending → reviewedAt y reviewedBy a NULL", async () => {
    const res = await updateReportStatusAction(fd({ id: "5", status: "pending" }))
    expect(res.ok).toBe(true)
    const data = mocks.reportUpdate.mock.calls[0][0].data
    expect(data.status).toBe("pending")
    expect(data.reviewedAt).toBeNull()
    expect(data.reviewedBy).toBeNull()
  })

  it("status inválido → no toca BBDD", async () => {
    const res = await updateReportStatusAction(fd({ id: "1", status: "trashed" }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/no v[áa]lido/i)
    expect(mocks.reportUpdate).not.toHaveBeenCalled()
  })

  it("id inválido → no toca BBDD", async () => {
    const res = await updateReportStatusAction(fd({ id: "abc", status: "reviewed" }))
    expect(res.ok).toBe(false)
    expect(mocks.reportUpdate).not.toHaveBeenCalled()
  })

  it("non-admin: requireAdmin tira notFound() → la action rebota la excepción", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("NEXT_NOT_FOUND"))
    await expect(
      updateReportStatusAction(fd({ id: "1", status: "reviewed" })),
    ).rejects.toThrow("NEXT_NOT_FOUND")
    expect(mocks.reportUpdate).not.toHaveBeenCalled()
  })
})

describe("bulkUpdateReportsForQuestionAction", () => {
  beforeEach(() => {
    mocks.requireAdmin.mockReset()
    mocks.reportUpdateMany.mockReset()
    mocks.requireAdmin.mockResolvedValue({ id: 7, username: "admin", role: "ADMIN" })
    mocks.reportUpdateMany.mockResolvedValue({ count: 3 })
  })

  it("admin cierra los pending de una pregunta como fixed", async () => {
    const res = await bulkUpdateReportsForQuestionAction(fd({
      questionId:    "1751",
      currentStatus: "pending",
      nextStatus:    "fixed",
    }))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.count).toBe(3)
    const arg = mocks.reportUpdateMany.mock.calls[0][0]
    expect(arg.where).toEqual({ questionId: 1751, status: "pending" })
    expect(arg.data.status).toBe("fixed")
    expect(arg.data.reviewedAt).toBeInstanceOf(Date)
    expect(arg.data.reviewedBy).toBe(7)
  })

  it("reabrir bulk a pending → reviewedAt y reviewedBy a NULL", async () => {
    await bulkUpdateReportsForQuestionAction(fd({
      questionId:    "1751",
      currentStatus: "fixed",
      nextStatus:    "pending",
    }))
    const data = mocks.reportUpdateMany.mock.calls[0][0].data
    expect(data.reviewedAt).toBeNull()
    expect(data.reviewedBy).toBeNull()
  })

  it("questionId inválido → no toca BBDD", async () => {
    const res = await bulkUpdateReportsForQuestionAction(fd({
      questionId:    "0",
      currentStatus: "pending",
      nextStatus:    "fixed",
    }))
    expect(res.ok).toBe(false)
    expect(mocks.reportUpdateMany).not.toHaveBeenCalled()
  })

  it("status inválido → no toca BBDD", async () => {
    const res = await bulkUpdateReportsForQuestionAction(fd({
      questionId:    "1",
      currentStatus: "trashed",
      nextStatus:    "fixed",
    }))
    expect(res.ok).toBe(false)
    expect(mocks.reportUpdateMany).not.toHaveBeenCalled()
  })

  it("non-admin: requireAdmin tira notFound() → la action rebota", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("NEXT_NOT_FOUND"))
    await expect(
      bulkUpdateReportsForQuestionAction(fd({
        questionId:    "1",
        currentStatus: "pending",
        nextStatus:    "fixed",
      })),
    ).rejects.toThrow("NEXT_NOT_FOUND")
    expect(mocks.reportUpdateMany).not.toHaveBeenCalled()
  })
})
