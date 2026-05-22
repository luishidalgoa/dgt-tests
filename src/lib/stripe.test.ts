import { describe, it, expect } from "vitest"
import type Stripe from "stripe"
import { getSubscriptionPeriodEnd, willNotAutoRenew, getSubscriptionEndDate } from "@/lib/stripe"

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

/**
 * Bug Fase 85: el portal de Stripe puede expresar "cancel at end of period"
 * de dos formas distintas y el webhook solo miraba una. El user veía la sub
 * "marcada para cancelar" en el portal pero nuestra app decía "renovación
 * activada" porque cancel_at_period_end seguía siendo false (Stripe usaba
 * cancel_at en su lugar).
 */
describe("willNotAutoRenew", () => {
  it("true si cancel_at_period_end es true", () => {
    const sub = { cancel_at_period_end: true, cancel_at: null } as unknown as Stripe.Subscription
    expect(willNotAutoRenew(sub)).toBe(true)
  })

  it("true si cancel_at es un timestamp futuro (aunque cancel_at_period_end sea false)", () => {
    const sub = { cancel_at_period_end: false, cancel_at: 1_782_085_288 } as unknown as Stripe.Subscription
    expect(willNotAutoRenew(sub)).toBe(true)
  })

  it("true cuando AMBOS están set", () => {
    const sub = { cancel_at_period_end: true, cancel_at: 1_782_085_288 } as unknown as Stripe.Subscription
    expect(willNotAutoRenew(sub)).toBe(true)
  })

  it("false cuando ninguno está set", () => {
    const sub = { cancel_at_period_end: false, cancel_at: null } as unknown as Stripe.Subscription
    expect(willNotAutoRenew(sub)).toBe(false)
  })

  it("false cuando cancel_at es 0 o negativo (defensivo)", () => {
    expect(willNotAutoRenew({ cancel_at_period_end: false, cancel_at: 0 } as unknown as Stripe.Subscription)).toBe(false)
    expect(willNotAutoRenew({ cancel_at_period_end: false, cancel_at: -1 } as unknown as Stripe.Subscription)).toBe(false)
  })
})

describe("getSubscriptionEndDate", () => {
  it("prefiere cancel_at sobre current_period_end cuando está set", () => {
    const sub = {
      cancel_at: 1_782_000_000,
      items: { data: [{ current_period_end: 1_780_000_000 }] },
    } as unknown as Stripe.Subscription
    expect(getSubscriptionEndDate(sub)).toBe(1_782_000_000)
  })

  it("cae a current_period_end del item si cancel_at no está", () => {
    const sub = {
      cancel_at: null,
      items: { data: [{ current_period_end: 1_780_000_000 }] },
    } as unknown as Stripe.Subscription
    expect(getSubscriptionEndDate(sub)).toBe(1_780_000_000)
  })

  it("null si no hay ni cancel_at ni period_end", () => {
    const sub = { cancel_at: null, items: { data: [] } } as unknown as Stripe.Subscription
    expect(getSubscriptionEndDate(sub)).toBeNull()
  })
})
