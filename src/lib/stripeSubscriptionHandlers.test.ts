import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  applySubscriptionUpdate,
  applySubscriptionDeleted,
} from "./stripeSubscriptionHandlers"

/**
 * Tests del flujo "evento Stripe → escritura en BBDD" del sistema de
 * renovación de tokens IA.
 *
 * Lo crítico que validamos:
 *   - Al COMPRAR (sub created)         → aiTokensRenewalAt = periodEnd
 *                                         + aiTokensUsed = 0 (reset)
 *   - Al RENOVAR (sub updated, +mes)   → ídem
 *   - Al cambiar estado sin avanzar mes → sync fecha, NO reset
 *   - Al CADUCAR (sub deleted)         → aiTokensRenewalAt = expiry+1mes
 *                                         + aiTokensUsed = 0 (reset)
 *
 * En todos los casos se verifica que `db.user.update` recibe el campo
 * correcto. Mockamos el db en memoria — no se toca SQLite ni Turso.
 */

function makeDeps() {
  return {
    user: {
      findUnique: vi.fn(),
      update:     vi.fn(),
    },
  }
}

describe("applySubscriptionUpdate — sub.created (compra inicial)", () => {
  let db: ReturnType<typeof makeDeps>

  beforeEach(() => {
    db = makeDeps()
    // Usuario nuevo sin sub previa
    db.user.findUnique.mockResolvedValue({
      role:                         "USER",
      subscriptionCancelAtPeriodEnd: false,
      subscriptionCurrentPeriodEnd:  null,
    })
    db.user.update.mockResolvedValue({})
  })

  it("setea aiTokensRenewalAt = newPeriodEnd y aiTokensUsed = 0", async () => {
    const newPeriodEnd = new Date("2026-06-20T00:00:00Z")
    const result = await applySubscriptionUpdate(
      {
        userId:             42,
        stripeCustomerId:   "cus_X",
        subscriptionId:     "sub_X",
        status:             "active",
        priceId:            "price_X",
        newPeriodEnd,
        cancelAtPeriodEnd:  false,
      },
      db,
    )

    expect(result.isRenewal).toBe(true)
    expect(db.user.update).toHaveBeenCalledTimes(1)
    const data = db.user.update.mock.calls[0]![0].data
    expect(data.aiTokensRenewalAt).toStrictEqual(newPeriodEnd)
    expect(data.aiTokensUsed).toBe(0)
    expect(data.role).toBe("SUBSCRIBER")
    expect(data.subscriptionStatus).toBe("active")
  })
})

describe("applySubscriptionUpdate — sub.updated (renovación mensual)", () => {
  let db: ReturnType<typeof makeDeps>

  beforeEach(() => {
    db = makeDeps()
    db.user.update.mockResolvedValue({})
  })

  it("renovación real (newPeriodEnd > oldPeriodEnd) → reset + actualiza fecha", async () => {
    const oldEnd = new Date("2026-05-20T00:00:00Z")
    const newEnd = new Date("2026-06-20T00:00:00Z")
    db.user.findUnique.mockResolvedValue({
      role:                         "SUBSCRIBER",
      subscriptionCancelAtPeriodEnd: false,
      subscriptionCurrentPeriodEnd:  oldEnd,
    })

    const result = await applySubscriptionUpdate(
      {
        userId: 42, stripeCustomerId: "cus_X", subscriptionId: "sub_X",
        status: "active", priceId: "price_X",
        newPeriodEnd: newEnd, cancelAtPeriodEnd: false,
      },
      db,
    )

    expect(result.isRenewal).toBe(true)
    const data = db.user.update.mock.calls[0]![0].data
    expect(data.aiTokensRenewalAt).toStrictEqual(newEnd)
    expect(data.aiTokensUsed).toBe(0)
  })

  it("status change SIN avanzar período → sync fecha pero NO resetea contador", async () => {
    const same = new Date("2026-06-20T00:00:00Z")
    db.user.findUnique.mockResolvedValue({
      role:                         "SUBSCRIBER",
      subscriptionCancelAtPeriodEnd: false,
      subscriptionCurrentPeriodEnd:  same,
    })

    const result = await applySubscriptionUpdate(
      {
        userId: 42, stripeCustomerId: "cus_X", subscriptionId: "sub_X",
        status: "past_due",  // ahora past_due, mismo período
        priceId: "price_X",
        newPeriodEnd: same, cancelAtPeriodEnd: false,
      },
      db,
    )

    expect(result.isRenewal).toBe(false)
    const data = db.user.update.mock.calls[0]![0].data
    expect(data.aiTokensRenewalAt).toStrictEqual(same)
    expect(data.aiTokensUsed).toBeUndefined()  // NO se incluye → no se resetea
  })
})

describe("applySubscriptionUpdate — preserva ADMIN", () => {
  it("user ADMIN NO se baja a SUBSCRIBER/USER aunque cambie la sub", async () => {
    const db = makeDeps()
    db.user.findUnique.mockResolvedValue({
      role:                         "ADMIN",
      subscriptionCancelAtPeriodEnd: false,
      subscriptionCurrentPeriodEnd:  null,
    })
    db.user.update.mockResolvedValue({})

    await applySubscriptionUpdate(
      {
        userId: 1, stripeCustomerId: "cus_X", subscriptionId: "sub_X",
        status: "active", priceId: "price_X",
        newPeriodEnd: new Date("2026-06-20T00:00:00Z"),
        cancelAtPeriodEnd: false,
      },
      db,
    )

    const data = db.user.update.mock.calls[0]![0].data
    expect(data.role).toBeUndefined()  // no se incluye → no se sobrescribe
  })
})

describe("applySubscriptionDeleted — caducidad", () => {
  let db: ReturnType<typeof makeDeps>

  beforeEach(() => {
    db = makeDeps()
    db.user.findUnique.mockResolvedValue({
      role:                         "SUBSCRIBER",
      subscriptionCancelAtPeriodEnd: false,
      subscriptionCurrentPeriodEnd:  new Date("2026-05-20T00:00:00Z"),
    })
    db.user.update.mockResolvedValue({})
  })

  it("setea aiTokensRenewalAt = endedAt + 1 mes y aiTokensUsed = 0", async () => {
    const endedAt = new Date("2026-05-20T00:00:00Z")
    await applySubscriptionDeleted({ userId: 42, endedAt }, db)

    expect(db.user.update).toHaveBeenCalledTimes(1)
    const data = db.user.update.mock.calls[0]![0].data
    expect(data.aiTokensRenewalAt).toBeInstanceOf(Date)
    expect((data.aiTokensRenewalAt as Date).toISOString()).toBe("2026-06-20T00:00:00.000Z")
    expect(data.aiTokensUsed).toBe(0)
    expect(data.subscriptionStatus).toBe("canceled")
    expect(data.role).toBe("USER")
  })

  it("expiry el 31 enero → renovación el 28 febrero (caps día)", async () => {
    await applySubscriptionDeleted(
      { userId: 42, endedAt: new Date("2026-01-31T00:00:00Z") },
      db,
    )
    const data = db.user.update.mock.calls[0]![0].data
    expect((data.aiTokensRenewalAt as Date).toISOString()).toBe("2026-02-28T00:00:00.000Z")
  })

  it("user ADMIN: NO se baja a USER (intocable) pero sí se resetean tokens", async () => {
    db.user.findUnique.mockResolvedValue({
      role:                         "ADMIN",
      subscriptionCancelAtPeriodEnd: false,
      subscriptionCurrentPeriodEnd:  null,
    })

    await applySubscriptionDeleted(
      { userId: 1, endedAt: new Date("2026-05-20T00:00:00Z") },
      db,
    )
    const data = db.user.update.mock.calls[0]![0].data
    expect(data.role).toBeUndefined()
    expect(data.aiTokensUsed).toBe(0)
    expect((data.aiTokensRenewalAt as Date).toISOString()).toBe("2026-06-20T00:00:00.000Z")
  })
})
