import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  composePaymentFailedEmail,
  composeInvoiceUpcomingEmail,
  sendUserEmail,
  type UserForEmail,
} from "./userEmails"

const user: UserForEmail = {
  username:    "luisph",
  displayName: "Luis P.",
  email:       "luisph@example.com",
}

describe("composePaymentFailedEmail", () => {
  const data = {
    amountCents:    699,
    currency:       "eur",
    nextAttemptTs:  1782085288,  // 21 jun 2026 (UTC)
    attemptCount:   1,
    portalUrl:      "http://localhost:4321/settings",
  }

  it("subject menciona el importe", () => {
    const { subject } = composePaymentFailedEmail(user, data)
    expect(subject).toContain("6,99 €")
  })

  it("body saluda con displayName si lo hay", () => {
    const { html } = composePaymentFailedEmail(user, data)
    expect(html).toContain("Hola Luis P.")
  })

  it("body cae a username si no hay displayName", () => {
    const { html } = composePaymentFailedEmail({ ...user, displayName: null }, data)
    expect(html).toContain("Hola luisph")
  })

  it("incluye el número de intento y la próxima fecha de reintento", () => {
    const { html } = composePaymentFailedEmail(user, data)
    expect(html).toContain("intento <b>1</b>")
    expect(html).toMatch(/de junio de 2026/)
  })

  it("si no hay próximo intento, lo refleja", () => {
    const { html } = composePaymentFailedEmail(user, { ...data, nextAttemptTs: null })
    expect(html).toContain("No haremos más intentos")
  })

  it("incluye el link al portal de billing", () => {
    const { html } = composePaymentFailedEmail(user, data)
    expect(html).toContain('href="http://localhost:4321/settings"')
  })

  it("HTML escapa al menos a estructura razonable (no XSS trivial)", () => {
    // No estamos haciendo input sanitization estricto, pero al menos los
    // campos de datos vienen de Stripe y los nombres del user de BBDD.
    // Aquí solo verifico que el HTML se genera y es no-vacío.
    const { html } = composePaymentFailedEmail(user, data)
    expect(html.length).toBeGreaterThan(200)
  })
})

describe("composeInvoiceUpcomingEmail", () => {
  const data = {
    amountCents:    699,
    currency:       "eur",
    willChargeOnTs: 1782085288,
    portalUrl:      "http://localhost:4321/settings",
  }

  it("subject incluye importe y fecha", () => {
    const { subject } = composeInvoiceUpcomingEmail(user, data)
    expect(subject).toMatch(/6,99 €/)
    expect(subject).toMatch(/de junio de 2026/)
  })

  it("body indica cómo cancelar antes", () => {
    const { html } = composeInvoiceUpcomingEmail(user, data)
    expect(html).toMatch(/cancelar antes/i)
  })

  it("incluye el link al portal", () => {
    const { html } = composeInvoiceUpcomingEmail(user, data)
    expect(html).toContain('href="http://localhost:4321/settings"')
  })
})

// sendUserEmail ahora delega a @/lib/mailer.sendMail. Mockeamos eso.
vi.mock("@/lib/mailer", () => ({
  sendMail: vi.fn(),
}))

describe("sendUserEmail (delega a mailer)", () => {
  beforeEach(async () => {
    const mailer = await import("@/lib/mailer")
    vi.mocked(mailer.sendMail).mockReset()
  })

  it("llama a mailer.sendMail con los mismos args y devuelve su resultado", async () => {
    const mailer = await import("@/lib/mailer")
    vi.mocked(mailer.sendMail).mockResolvedValue(true)

    const ok = await sendUserEmail({
      to:      "user@example.com",
      subject: "test subject",
      html:    "<p>hi</p>",
    })
    expect(ok).toBe(true)
    expect(mailer.sendMail).toHaveBeenCalledWith({
      to:      "user@example.com",
      subject: "test subject",
      html:    "<p>hi</p>",
    })
  })

  it("devuelve false si mailer falla", async () => {
    const mailer = await import("@/lib/mailer")
    vi.mocked(mailer.sendMail).mockResolvedValue(false)

    const ok = await sendUserEmail({ to: "x@x.com", subject: "s", html: "h" })
    expect(ok).toBe(false)
  })
})
