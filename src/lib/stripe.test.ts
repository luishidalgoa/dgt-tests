import { describe, it, expect } from "vitest"
import type Stripe from "stripe"
import { getSubscriptionPeriodEnd } from "@/lib/stripe"

/**
 * Bug Fase 76: con la API de Stripe '2024-09-30.acacia' en adelante,
 * `current_period_end` se movió del top-level de Subscription a los
 * subscription items. Nuestro webhook leía del campo viejo y guardaba
 * null en BBDD → /settings no podía mostrar fechas.
 *
 * El helper debe:
 *   1. Preferir items.data[0].current_period_end (API nueva)
 *   2. Caer al campo top-level si no hay item (API vieja)
 *   3. Devolver null si ninguno está disponible
 */
describe("getSubscriptionPeriodEnd", () => {
  it("lee del primer item cuando está presente (API nueva)", () => {
    const sub = {
      items: {
        data: [{ current_period_end: 1_780_000_000 }],
      },
    } as unknown as Stripe.Subscription
    expect(getSubscriptionPeriodEnd(sub)).toBe(1_780_000_000)
  })

  it("cae al top-level si no hay items (API antigua)", () => {
    const sub = {
      items: { data: [] },
      current_period_end: 1_770_000_000,
    } as unknown as Stripe.Subscription
    expect(getSubscriptionPeriodEnd(sub)).toBe(1_770_000_000)
  })

  it("prefiere el item por encima del top-level si los dos existen", () => {
    const sub = {
      items: {
        data: [{ current_period_end: 1_780_000_000 }],
      },
      current_period_end: 1_770_000_000,
    } as unknown as Stripe.Subscription
    expect(getSubscriptionPeriodEnd(sub)).toBe(1_780_000_000)
  })

  it("devuelve null si no hay nada", () => {
    const sub = { items: { data: [] } } as unknown as Stripe.Subscription
    expect(getSubscriptionPeriodEnd(sub)).toBeNull()
  })

  it("devuelve null si items es undefined", () => {
    const sub = {} as unknown as Stripe.Subscription
    expect(getSubscriptionPeriodEnd(sub)).toBeNull()
  })

  it("ignora item.current_period_end no-numérico", () => {
    const sub = {
      items: {
        data: [{ current_period_end: null }],
      },
      current_period_end: 1_770_000_000,
    } as unknown as Stripe.Subscription
    expect(getSubscriptionPeriodEnd(sub)).toBe(1_770_000_000)
  })
})
