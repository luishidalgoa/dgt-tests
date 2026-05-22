import { describe, it, expect } from "vitest"
import {
  hasFullAccess,
  isInGracePeriod,
  isActiveSubscription,
  planLabel,
} from "@/lib/permissions"
import type { UserForGate } from "@/lib/permissions"

/**
 * Tests del flujo de recuperación: user en past_due actualiza la tarjeta,
 * Stripe cobra OK, sub vuelve a active.
 *
 * No requiere código nuevo: customer.subscription.updated ya cambia
 * status a active. Estos tests verifican que la propagación a través de
 * hasFullAccess / planLabel / isInGracePeriod / isActiveSubscription es
 * correcta y consistente, y vigilan que un refactor futuro no rompa la
 * transición.
 */

// Helper devuelve NonNullable para que TS no se queje al leer
// user.subscriptionStatus directamente en los tests.
function u(status: string | null): NonNullable<UserForGate> {
  return { role: "SUBSCRIBER", subscriptionStatus: status }
}

describe("Flujo de recuperación past_due → active (Fase 87)", () => {
  it("estado past_due: acceso por grace, badge PRO, no es active", () => {
    const user = u("past_due")
    expect(hasFullAccess(user)).toBe(true)
    expect(isInGracePeriod(user)).toBe(true)
    expect(isActiveSubscription(user.subscriptionStatus)).toBe(false)
    expect(planLabel(user)).toBe("PRO")
  })

  it("transición past_due → active: sigue con acceso, ya no en grace", () => {
    const user = u("active")
    expect(hasFullAccess(user)).toBe(true)
    expect(isInGracePeriod(user)).toBe(false)  // ← cambió
    expect(isActiveSubscription(user.subscriptionStatus)).toBe(true)
    expect(planLabel(user)).toBe("PRO")
  })

  it("transición active → past_due: mantiene acceso (no pérdida brusca)", () => {
    // Simulación del momento exacto en que Stripe falla un cobro.
    // El user no debe perder PRO inmediatamente.
    const before = u("active")
    const after  = u("past_due")
    expect(hasFullAccess(before)).toBe(true)
    expect(hasFullAccess(after)).toBe(true)   // ← regresión Fase 86
    expect(planLabel(before)).toBe(planLabel(after))  // ambos "PRO"
  })

  it("transición past_due → unpaid (Stripe se rinde): pérdida de acceso", () => {
    const before = u("past_due")
    const after  = u("unpaid")
    expect(hasFullAccess(before)).toBe(true)
    expect(hasFullAccess(after)).toBe(false)  // ← acceso revocado
    expect(planLabel(before)).toBe("PRO")
    expect(planLabel(after)).toBe("FREE")
  })

  it("transición past_due → canceled (user canceló durante grace): pérdida de acceso", () => {
    const before = u("past_due")
    const after  = u("canceled")
    expect(hasFullAccess(before)).toBe(true)
    expect(hasFullAccess(after)).toBe(false)
  })
})
