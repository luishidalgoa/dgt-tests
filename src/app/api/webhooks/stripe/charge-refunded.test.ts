import { describe, it, expect, vi, beforeEach } from "vitest"
import { handleChargeRefunded } from "@/lib/handleChargeRefunded"

/**
 * Política (Fase 88):
 *   - charge.refunded con amount_refunded === amount → REFUND TOTAL.
 *     Revocar acceso: cancelar sub en Stripe (immediate) + marcar
 *     role=USER + status=canceled en BBDD.
 *   - charge.refunded con amount_refunded < amount → REFUND PARCIAL.
 *     Solo log, sin cambios (es un ajuste, no anulación).
 *   - Sin user asociado → solo log.
 */

describe("handleChargeRefunded", () => {
  type Charge = {
    id:                 string
    customer:           string | null
    amount:             number
    amount_refunded:    number
  }
  type Sub = { id: string; status: string }
  type UserRow = {
    id: number
    username: string
    role: "USER" | "SUBSCRIBER" | "ADMIN"
    stripeCustomerId:     string | null
    stripeSubscriptionId: string | null
  }
  type Deps = {
    db: {
      user: {
        findFirst: ReturnType<typeof vi.fn>
        update:    ReturnType<typeof vi.fn>
      }
    }
    stripe: {
      subscriptions: {
        cancel: ReturnType<typeof vi.fn>
      }
    }
  }

  function makeDeps(): Deps {
    return {
      db: {
        user: {
          findFirst: vi.fn(),
          update:    vi.fn(),
        },
      },
      stripe: {
        subscriptions: {
          cancel: vi.fn(),
        },
      },
    }
  }

  const subscriberUser: UserRow = {
    id: 1, username: "luis", role: "SUBSCRIBER",
    stripeCustomerId: "cus_X", stripeSubscriptionId: "sub_X",
  }
  const fullRefund: Charge = { id: "ch_1", customer: "cus_X", amount: 699, amount_refunded: 699 }
  const partialRefund: Charge = { id: "ch_1", customer: "cus_X", amount: 699, amount_refunded: 300 }

  let deps: Deps
  beforeEach(() => { deps = makeDeps() })

  it("refund TOTAL + SUBSCRIBER con sub activa: cancela sub + revoca acceso", async () => {
    deps.db.user.findFirst.mockResolvedValue(subscriberUser)
    deps.stripe.subscriptions.cancel.mockResolvedValue({ id: "sub_X", status: "canceled" } as Sub)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleChargeRefunded(fullRefund as any, deps as any)

    expect(deps.stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_X")
    expect(deps.db.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        role: "USER",
        subscriptionStatus: "canceled",
      }),
    })
  })

  it("refund PARCIAL: solo loguea, no toca nada", async () => {
    deps.db.user.findFirst.mockResolvedValue(subscriberUser)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleChargeRefunded(partialRefund as any, deps as any)

    expect(deps.stripe.subscriptions.cancel).not.toHaveBeenCalled()
    expect(deps.db.user.update).not.toHaveBeenCalled()
  })

  it("refund TOTAL pero user es ADMIN: nunca tocar role (admins son intocables)", async () => {
    deps.db.user.findFirst.mockResolvedValue({ ...subscriberUser, role: "ADMIN" })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleChargeRefunded(fullRefund as any, deps as any)

    expect(deps.db.user.update).not.toHaveBeenCalled()
  })

  it("refund TOTAL sin user asociado (customer desconocido): solo log, no crash", async () => {
    deps.db.user.findFirst.mockResolvedValue(null)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(handleChargeRefunded(fullRefund as any, deps as any)).resolves.not.toThrow()
    expect(deps.db.user.update).not.toHaveBeenCalled()
    expect(deps.stripe.subscriptions.cancel).not.toHaveBeenCalled()
  })

  it("refund TOTAL sin customer (charge anónima): no rompe", async () => {
    const noCustomer = { ...fullRefund, customer: null }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(handleChargeRefunded(noCustomer as any, deps as any)).resolves.not.toThrow()
    expect(deps.db.user.findFirst).not.toHaveBeenCalled()
  })

  it("user con stripeSubscriptionId null: marca DB pero no llama a cancel (no hay nada que cancelar)", async () => {
    deps.db.user.findFirst.mockResolvedValue({ ...subscriberUser, stripeSubscriptionId: null })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleChargeRefunded(fullRefund as any, deps as any)

    expect(deps.stripe.subscriptions.cancel).not.toHaveBeenCalled()
    expect(deps.db.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ role: "USER" }),
    })
  })

  it("si stripe.cancel falla, igual marca DB (no queda inconsistente)", async () => {
    deps.db.user.findFirst.mockResolvedValue(subscriberUser)
    deps.stripe.subscriptions.cancel.mockRejectedValue(new Error("Stripe API down"))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleChargeRefunded(fullRefund as any, deps as any)

    expect(deps.db.user.update).toHaveBeenCalled()
  })
})
