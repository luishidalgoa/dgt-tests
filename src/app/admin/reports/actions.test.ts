import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAdmin:    vi.fn(),
  reportUpdate:    vi.fn(),
}))

vi.mock("@/lib/adminGuard", () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock("@/lib/db", () => ({
  db: { questionReport: { update: mocks.reportUpdate } },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { updateReportStatusAction } from "./actions"

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
