import { describe, it, expect } from "vitest"
import {
  hasFullAccess,
  isAdmin,
  isActiveSubscription,
  isInGracePeriod,
  planLabel,
  canAccessTest,
  getEffectiveTokenQuota,
  AI_TOKENS_FREE,
  AI_TOKENS_PRO,
  FREE_CATEGORY_SLUG,
  FREE_TEST_LIMIT,
} from "@/lib/permissions"
import type { UserForGate } from "@/lib/permissions"

function u(
  role: "USER" | "SUBSCRIBER" | "ADMIN",
  subscriptionStatus: string | null = null
): UserForGate {
  return { role, subscriptionStatus }
}

describe("isActiveSubscription", () => {
  it("active y trialing cuentan", () => {
    expect(isActiveSubscription("active")).toBe(true)
    expect(isActiveSubscription("trialing")).toBe(true)
  })

  it("canceled / past_due / null no cuentan", () => {
    expect(isActiveSubscription("canceled")).toBe(false)
    expect(isActiveSubscription("past_due")).toBe(false)
    expect(isActiveSubscription(null)).toBe(false)
    expect(isActiveSubscription(undefined)).toBe(false)
  })
})

describe("hasFullAccess", () => {
  it("ADMIN siempre tiene acceso, aunque no tenga sub", () => {
    expect(hasFullAccess(u("ADMIN"))).toBe(true)
    expect(hasFullAccess(u("ADMIN", null))).toBe(true)
  })

  it("SUBSCRIBER + active = acceso completo", () => {
    expect(hasFullAccess(u("SUBSCRIBER", "active"))).toBe(true)
    expect(hasFullAccess(u("SUBSCRIBER", "trialing"))).toBe(true)
  })

  it("Fase 86: SUBSCRIBER + past_due = SIGUE con acceso (grace period)", () => {
    // Cuando un cobro de renovación falla, Stripe deja el sub en past_due
    // durante ~3 semanas mientras reintenta. Le damos al usuario acceso
    // durante ese tiempo para que pueda actualizar su tarjeta sin perder
    // el servicio bruscamente.
    expect(hasFullAccess(u("SUBSCRIBER", "past_due"))).toBe(true)
  })

  it("SUBSCRIBER + canceled = NO acceso (Stripe se rindió tras los reintentos)", () => {
    expect(hasFullAccess(u("SUBSCRIBER", "canceled"))).toBe(false)
  })

  it("SUBSCRIBER + unpaid = NO acceso (Stripe agotó reintentos sin pagar)", () => {
    expect(hasFullAccess(u("SUBSCRIBER", "unpaid"))).toBe(false)
  })

  it("USER no tiene acceso aunque tenga status='active' (raro pero defensivo)", () => {
    expect(hasFullAccess(u("USER", "active"))).toBe(false)
  })

  it("null user → no acceso", () => {
    expect(hasFullAccess(null)).toBe(false)
  })
})

describe("isInGracePeriod (Fase 86)", () => {
  it("true cuando status es past_due", () => {
    expect(isInGracePeriod(u("SUBSCRIBER", "past_due"))).toBe(true)
  })

  it("false cuando status es active, canceled, unpaid o null", () => {
    expect(isInGracePeriod(u("SUBSCRIBER", "active"))).toBe(false)
    expect(isInGracePeriod(u("SUBSCRIBER", "canceled"))).toBe(false)
    expect(isInGracePeriod(u("SUBSCRIBER", "unpaid"))).toBe(false)
    expect(isInGracePeriod(u("SUBSCRIBER", null))).toBe(false)
    expect(isInGracePeriod(u("USER"))).toBe(false)
    expect(isInGracePeriod(null)).toBe(false)
  })
})

describe("planLabel", () => {
  it("ADMIN gana sobre todo lo demás", () => {
    expect(planLabel(u("ADMIN"))).toBe("ADMIN")
    expect(planLabel(u("ADMIN", "active"))).toBe("ADMIN")
  })

  it("SUBSCRIBER activo → PRO", () => {
    expect(planLabel(u("SUBSCRIBER", "active"))).toBe("PRO")
  })

  it("SUBSCRIBER con status canceled/unpaid → FREE (acceso ya degradado)", () => {
    expect(planLabel(u("SUBSCRIBER", "canceled"))).toBe("FREE")
    expect(planLabel(u("SUBSCRIBER", "unpaid"))).toBe("FREE")
  })

  it("Fase 86: SUBSCRIBER + past_due → PRO (sigue en grace period)", () => {
    // El navbar no debe mostrar 'Plan gratuito' a un user que todavía
    // tiene acceso. La explicación del fallo va en /settings.
    expect(planLabel(u("SUBSCRIBER", "past_due"))).toBe("PRO")
  })

  it("USER → FREE", () => {
    expect(planLabel(u("USER"))).toBe("FREE")
  })

  it("null → null (no logueado)", () => {
    expect(planLabel(null)).toBeNull()
  })
})

describe("canAccessTest", () => {
  it("ADMIN puede acceder a cualquier test", () => {
    expect(canAccessTest(u("ADMIN"), "repaso-final", 1)).toBe(true)
    expect(canAccessTest(u("ADMIN"), "adas", 88)).toBe(true)
  })

  it("USER solo a permiso-b 1..7", () => {
    expect(canAccessTest(u("USER"), FREE_CATEGORY_SLUG, 1)).toBe(true)
    expect(canAccessTest(u("USER"), FREE_CATEGORY_SLUG, FREE_TEST_LIMIT)).toBe(true)
    expect(canAccessTest(u("USER"), FREE_CATEGORY_SLUG, FREE_TEST_LIMIT + 1)).toBe(false)
    expect(canAccessTest(u("USER"), "repaso-final", 1)).toBe(false)
  })

  it("guest (null) se comporta como USER", () => {
    expect(canAccessTest(null, FREE_CATEGORY_SLUG, 1)).toBe(true)
    expect(canAccessTest(null, FREE_CATEGORY_SLUG, FREE_TEST_LIMIT + 1)).toBe(false)
    expect(canAccessTest(null, "repaso-final", 1)).toBe(false)
  })
})

describe("getEffectiveTokenQuota", () => {
  it("PRO/ADMIN tienen AI_TOKENS_PRO", () => {
    expect(getEffectiveTokenQuota(u("SUBSCRIBER", "active"))).toBe(AI_TOKENS_PRO)
    expect(getEffectiveTokenQuota(u("ADMIN"))).toBe(AI_TOKENS_PRO)
  })

  it("FREE tiene AI_TOKENS_FREE", () => {
    expect(getEffectiveTokenQuota(u("USER"))).toBe(AI_TOKENS_FREE)
    expect(getEffectiveTokenQuota(u("SUBSCRIBER", "canceled"))).toBe(AI_TOKENS_FREE)
    expect(getEffectiveTokenQuota(null)).toBe(AI_TOKENS_FREE)
  })

  it("constantes vigentes (regresión: subimos PRO de 50 → 60 en Fase 72)", () => {
    expect(AI_TOKENS_PRO).toBe(60)
    expect(AI_TOKENS_FREE).toBe(10)
  })
})

describe("isAdmin", () => {
  it("solo true cuando role==='ADMIN'", () => {
    expect(isAdmin(u("ADMIN"))).toBe(true)
    expect(isAdmin(u("SUBSCRIBER", "active"))).toBe(false)
    expect(isAdmin(u("USER"))).toBe(false)
    expect(isAdmin(null)).toBe(false)
  })
})
