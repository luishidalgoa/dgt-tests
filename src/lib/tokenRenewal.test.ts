import { describe, it, expect } from "vitest"
import {
  addOneMonthUtc,
  advanceUntilFuture,
  computeRegistrationRenewal,
  computeInitialRenewal,
  computeRenewalAfterSubUpdate,
  computeRenewalAfterSubExpiry,
} from "./tokenRenewal"

/**
 * Tests de las funciones PURAS de cálculo de renovación de tokens IA.
 * Aquí no se mockea BBDD: solo se valida la matemática de fechas y las
 * decisiones (¿hay que resetear contador? ¿qué fecha es la nueva?).
 */

describe("addOneMonthUtc", () => {
  it("añade un mes natural", () => {
    expect(addOneMonthUtc(new Date("2026-01-15T10:00:00Z")).toISOString())
      .toBe("2026-02-15T10:00:00.000Z")
  })

  it("31 enero → 28 febrero (año no bisiesto)", () => {
    expect(addOneMonthUtc(new Date("2026-01-31T00:00:00Z")).toISOString())
      .toBe("2026-02-28T00:00:00.000Z")
  })

  it("31 enero → 29 febrero (año bisiesto)", () => {
    expect(addOneMonthUtc(new Date("2024-01-31T00:00:00Z")).toISOString())
      .toBe("2024-02-29T00:00:00.000Z")
  })

  it("31 marzo → 30 abril", () => {
    expect(addOneMonthUtc(new Date("2026-03-31T00:00:00Z")).toISOString())
      .toBe("2026-04-30T00:00:00.000Z")
  })

  it("cruza año (31 diciembre → 31 enero)", () => {
    expect(addOneMonthUtc(new Date("2026-12-31T00:00:00Z")).toISOString())
      .toBe("2027-01-31T00:00:00.000Z")
  })
})

describe("advanceUntilFuture", () => {
  it("no avanza si ya es futuro", () => {
    const now    = new Date("2026-05-15T10:00:00Z")
    const future = new Date("2026-06-15T10:00:00Z")
    expect(advanceUntilFuture(future, now).toISOString()).toBe(future.toISOString())
  })

  it("avanza 1 mes si fecha == now", () => {
    const now = new Date("2026-05-15T10:00:00Z")
    expect(advanceUntilFuture(now, now).toISOString()).toBe("2026-06-15T10:00:00.000Z")
  })

  it("avanza varios meses si la fecha está muy en el pasado", () => {
    const now      = new Date("2026-10-20T00:00:00Z")
    const stale    = new Date("2026-05-15T00:00:00Z")
    const expected = "2026-11-15T00:00:00.000Z"  // mayo → jun → jul → ago → sep → oct (pasado) → nov
    expect(advanceUntilFuture(stale, now).toISOString()).toBe(expected)
  })
})

describe("computeRegistrationRenewal", () => {
  it("es exactamente createdAt + 1 mes", () => {
    const createdAt = new Date("2026-05-15T10:00:00Z")
    expect(computeRegistrationRenewal(createdAt).toISOString())
      .toBe("2026-06-15T10:00:00.000Z")
  })

  it("se registró el 31 de enero → renovación 28 de febrero", () => {
    const createdAt = new Date("2026-01-31T12:00:00Z")
    expect(computeRegistrationRenewal(createdAt).toISOString())
      .toBe("2026-02-28T12:00:00.000Z")
  })
})

describe("computeInitialRenewal (lazy backfill)", () => {
  it("user FREE: ancla en createdAt + 1 mes y avanza hasta futuro", () => {
    const now = new Date("2026-06-01T00:00:00Z")
    const r = computeInitialRenewal(
      { createdAt: new Date("2026-01-15T00:00:00Z"), subscriptionCurrentPeriodEnd: null },
      now,
    )
    // createdAt + 1 = feb 15 (pasado), avanza hasta futuro → jun 15
    expect(r.toISOString()).toBe("2026-06-15T00:00:00.000Z")
  })

  it("user con subscriptionCurrentPeriodEnd activa: ancla en esa fecha", () => {
    const now = new Date("2026-06-01T00:00:00Z")
    const r = computeInitialRenewal(
      {
        createdAt:                     new Date("2026-01-15T00:00:00Z"),
        subscriptionCurrentPeriodEnd:  new Date("2026-06-20T00:00:00Z"),
      },
      now,
    )
    expect(r.toISOString()).toBe("2026-06-20T00:00:00.000Z")
  })

  it("user ex-PRO con expiry pasado: avanza desde la fecha de expiry", () => {
    const now = new Date("2026-10-01T00:00:00Z")
    const r = computeInitialRenewal(
      {
        createdAt:                     new Date("2025-01-15T00:00:00Z"),
        subscriptionCurrentPeriodEnd:  new Date("2026-05-20T00:00:00Z"),  // expirió en mayo
      },
      now,
    )
    // anniversary days: jun 20, jul 20, ago 20, sep 20, oct 20 (futuro!)
    expect(r.toISOString()).toBe("2026-10-20T00:00:00.000Z")
  })
})

describe("computeRenewalAfterSubUpdate (compra / renovación)", () => {
  it("primera suscripción (oldPeriodEnd null) → reset + nueva fecha", () => {
    const newEnd = new Date("2026-06-20T00:00:00Z")
    const r = computeRenewalAfterSubUpdate(newEnd, null)
    expect(r.aiTokensRenewalAt?.toISOString()).toBe("2026-06-20T00:00:00.000Z")
    expect(r.shouldResetTokens).toBe(true)
  })

  it("renovación mensual (newPeriodEnd > old) → reset + nueva fecha", () => {
    const oldEnd = new Date("2026-05-20T00:00:00Z")
    const newEnd = new Date("2026-06-20T00:00:00Z")
    const r = computeRenewalAfterSubUpdate(newEnd, oldEnd)
    expect(r.aiTokensRenewalAt?.toISOString()).toBe("2026-06-20T00:00:00.000Z")
    expect(r.shouldResetTokens).toBe(true)
  })

  it("status change sin avanzar período → solo sync, NO reset", () => {
    const sameEnd = new Date("2026-06-20T00:00:00Z")
    const r = computeRenewalAfterSubUpdate(sameEnd, sameEnd)
    expect(r.aiTokensRenewalAt?.toISOString()).toBe("2026-06-20T00:00:00.000Z")
    expect(r.shouldResetTokens).toBe(false)
  })

  it("newPeriodEnd null (sub sin fecha) → no hace nada", () => {
    const r = computeRenewalAfterSubUpdate(null, new Date("2026-05-20T00:00:00Z"))
    expect(r.aiTokensRenewalAt).toBeNull()
    expect(r.shouldResetTokens).toBe(false)
  })
})

describe("computeRenewalAfterSubExpiry (caducidad)", () => {
  it("expiry el día 20 → próxima renovación el día 20 del mes siguiente", () => {
    const endedAt = new Date("2026-05-20T00:00:00Z")
    const r = computeRenewalAfterSubExpiry(endedAt)
    expect(r.aiTokensRenewalAt?.toISOString()).toBe("2026-06-20T00:00:00.000Z")
    expect(r.shouldResetTokens).toBe(true)
  })

  it("expiry el 31 enero → renovación 28 febrero (cap día)", () => {
    const endedAt = new Date("2026-01-31T00:00:00Z")
    const r = computeRenewalAfterSubExpiry(endedAt)
    expect(r.aiTokensRenewalAt?.toISOString()).toBe("2026-02-28T00:00:00.000Z")
  })

  it("endedAt null → reset pero sin nueva fecha (raro pero seguro)", () => {
    const r = computeRenewalAfterSubExpiry(null)
    expect(r.aiTokensRenewalAt).toBeNull()
    expect(r.shouldResetTokens).toBe(true)
  })
})
