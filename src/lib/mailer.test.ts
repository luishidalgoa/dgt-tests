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

import { sendMail, _resetMailerForTests } from "./mailer"
import nodemailer from "nodemailer"

describe("sendMail (nodemailer + Gmail)", () => {
  beforeEach(() => {
    sendMailMock.mockReset()
    vi.mocked(nodemailer.createTransport).mockClear()
    _resetMailerForTests()
    // Limpiamos primero por si .env local se hubiera filtrado al proceso
    delete process.env.GMAIL_FROM
    process.env.GMAIL_USER = "test@gmail.com"
    process.env.GMAIL_APP_PASSWORD = "abcd efgh ijkl mnop"
  })
  afterEach(() => {
    delete process.env.GMAIL_USER
    delete process.env.GMAIL_APP_PASSWORD
    delete process.env.GMAIL_FROM
  })

  it("crea el transporter con auth de Gmail y envía", async () => {
    sendMailMock.mockResolvedValue({ messageId: "abc" })
    const ok = await sendMail({
      to: "user@example.com",
      subject: "test",
      html: "<p>hi</p>",
    })
    expect(ok).toBe(true)
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      service: "gmail",
      auth: { user: "test@gmail.com", pass: "abcd efgh ijkl mnop" },
    })
    expect(sendMailMock).toHaveBeenCalledWith({
      from:    "test@gmail.com",
      to:      "user@example.com",
      subject: "test",
      html:    "<p>hi</p>",
    })
  })

  it("usa GMAIL_FROM si está definido (formato 'Nombre <email>')", async () => {
    process.env.GMAIL_FROM = "DGT Tests <luis@dgt-tests.local>"
    sendMailMock.mockResolvedValue({ messageId: "abc" })
    await sendMail({ to: "x@x.com", subject: "s", html: "h" })
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: "DGT Tests <luis@dgt-tests.local>" })
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

  it("devuelve false sin GMAIL_USER y NO crea transporter", async () => {
    delete process.env.GMAIL_USER
    const ok = await sendMail({ to: "x@x.com", subject: "s", html: "h" })
    expect(ok).toBe(false)
    expect(nodemailer.createTransport).not.toHaveBeenCalled()
  })

  it("devuelve false sin GMAIL_APP_PASSWORD", async () => {
    delete process.env.GMAIL_APP_PASSWORD
    const ok = await sendMail({ to: "x@x.com", subject: "s", html: "h" })
    expect(ok).toBe(false)
  })

  it("devuelve false si transporter.sendMail tira", async () => {
    sendMailMock.mockRejectedValue(new Error("SMTP closed"))
    const ok = await sendMail({ to: "x@x.com", subject: "s", html: "h" })
    expect(ok).toBe(false)
  })
})
