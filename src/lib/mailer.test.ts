import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Mock de nodemailer ANTES de importar el módulo bajo test.
// Vitest hoistea esto al top.
const sendMailMock = vi.fn()
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: sendMailMock,
    })),
  },
}))

// Mock de getEffectiveSecret para que LEA SOLO de process.env durante
// los tests, ignorando la BBDD. Sin esto, si el dev tiene
// RESEND_API_KEY configurada en /admin/secrets, el test ve ese
// valor en lugar del que controla con `delete process.env.*`.
vi.mock("@/lib/secretCatalog", () => ({
  getEffectiveSecret: vi.fn(async (key: string) => process.env[key] ?? null),
}))

// Config SMTP editable desde /admin. En tests devolvemos los defaults de
// Resend; getMailFrom respeta process.env.MAIL_FROM para el test del override.
vi.mock("@/lib/configCatalog", () => ({
  getMailFrom: vi.fn(async () => process.env.MAIL_FROM ?? "DGT-TESTS <noreply@hdglabs.com>"),
  getSmtpHost: vi.fn(async () => "smtp.resend.com"),
  getSmtpPort: vi.fn(async () => 465),
  getSmtpUser: vi.fn(async () => "resend"),
}))

import { sendMail, _resetMailerForTests } from "./mailer"
import nodemailer from "nodemailer"

const DEFAULT_FROM = "DGT-TESTS <noreply@hdglabs.com>"

describe("sendMail (nodemailer + Resend SMTP)", () => {
  beforeEach(() => {
    sendMailMock.mockReset()
    vi.mocked(nodemailer.createTransport).mockClear()
    _resetMailerForTests()
    // Limpiamos primero por si .env local se hubiera filtrado al proceso
    delete process.env.MAIL_FROM
    process.env.RESEND_API_KEY = "re_test_key"
  })
  afterEach(() => {
    delete process.env.RESEND_API_KEY
    delete process.env.MAIL_FROM
  })

  it("crea el transporter con SMTP de Resend y envía con el from por defecto", async () => {
    sendMailMock.mockResolvedValue({ messageId: "abc" })
    const ok = await sendMail({
      to: "user@example.com",
      subject: "test",
      html: "<p>hi</p>",
    })
    expect(ok).toBe(true)
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host:   "smtp.resend.com",
      port:   465,
      secure: true,
      auth:   { user: "resend", pass: "re_test_key" },
    })
    expect(sendMailMock).toHaveBeenCalledWith({
      from:    DEFAULT_FROM,
      to:      "user@example.com",
      subject: "test",
      html:    "<p>hi</p>",
    })
  })

  it("usa MAIL_FROM si está definido (formato 'Nombre <email>')", async () => {
    process.env.MAIL_FROM = "DGT-TESTS Alertas <alertas@hdglabs.com>"
    sendMailMock.mockResolvedValue({ messageId: "abc" })
    await sendMail({ to: "x@x.com", subject: "s", html: "h" })
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: "DGT-TESTS Alertas <alertas@hdglabs.com>" })
    )
  })

  it("permite override del from en cada llamada", async () => {
    sendMailMock.mockResolvedValue({ messageId: "abc" })
    await sendMail({
      from: "custom@example.com",
      to:   "x@x.com",
      subject: "s",
      html: "h",
    })
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: "custom@example.com" })
    )
  })

  it("cachea el transporter (no se recrea entre llamadas)", async () => {
    sendMailMock.mockResolvedValue({ messageId: "abc" })
    await sendMail({ to: "a@a.com", subject: "s", html: "h" })
    await sendMail({ to: "b@b.com", subject: "s", html: "h" })
    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1)
    expect(sendMailMock).toHaveBeenCalledTimes(2)
  })

  it("devuelve false sin RESEND_API_KEY y NO crea transporter", async () => {
    delete process.env.RESEND_API_KEY
    const ok = await sendMail({ to: "x@x.com", subject: "s", html: "h" })
    expect(ok).toBe(false)
    expect(nodemailer.createTransport).not.toHaveBeenCalled()
  })

  it("devuelve false si transporter.sendMail tira", async () => {
    sendMailMock.mockRejectedValue(new Error("SMTP closed"))
    const ok = await sendMail({ to: "x@x.com", subject: "s", html: "h" })
    expect(ok).toBe(false)
  })
})
