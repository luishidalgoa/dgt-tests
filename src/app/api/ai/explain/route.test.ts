import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Mocks ─────────────────────────────────────────────────────────────
// Hoisted al top por Vitest. Tienen que estar ANTES del import del módulo.

vi.mock("@/lib/db", () => ({
  db: {
    userAiPaid: {
      findFirst: vi.fn(),
      create:    vi.fn(),
    },
    aICacheEntry: {
      findUnique: vi.fn(),
      upsert:     vi.fn(),
    },
    question: {
      findUnique: vi.fn(),
    },
    user: {
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}))

vi.mock("@/lib/aiQuota", () => ({
  consumeToken:   vi.fn(),
  getQuotaStatus: vi.fn(),
}))

// Mockeamos solo explainQuestion (la llamada a Gemini); el resto del
// módulo (GeminiError, tipos) lo dejamos real para poder hacer `instanceof`.
vi.mock("@/lib/ai", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai")>("@/lib/ai")
  return {
    ...actual,
    explainQuestion: vi.fn(),
  }
})

import { GET, POST } from "@/app/api/ai/explain/route"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { consumeToken, getQuotaStatus } from "@/lib/aiQuota"
import { explainQuestion, AIProviderError } from "@/lib/ai"

const fakeUser = { id: 1, username: "luis" }
const fakeQuota = { used: 1, max: 60, remaining: 59, month: "2026-05", resetsAt: "..." }
const fakeResult = {
  mainExplanation: "...",
  whyCorrect:      "...",
  whyOthersWrong:  {},
  keyPhrases:      [],
  highlightLetras: ["A"],
}
const fakeCacheRow = {
  questionId: 100, withImage: false, payloadJson: JSON.stringify(fakeResult),
}

function postBody(body: Record<string, unknown>) {
  return new Request("http://localhost/api/ai/explain", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  })
}

function getReq(qs: string) {
  return new Request(`http://localhost/api/ai/explain?${qs}`)
}

describe("/api/ai/explain POST — cobro de tokens", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockResolvedValue(fakeUser as never)
    vi.mocked(getQuotaStatus).mockResolvedValue(fakeQuota)
    vi.mocked(consumeToken).mockResolvedValue(fakeQuota)
    vi.mocked(db.aICacheEntry.findUnique).mockResolvedValue(fakeCacheRow as never)
    vi.mocked(db.userAiPaid.findFirst).mockResolvedValue(null)  // sin pago previo
    vi.mocked(db.userAiPaid.create).mockResolvedValue({} as never)
    vi.mocked(explainQuestion).mockResolvedValue(fakeResult)
  })

  it("primera vez: consume token + marca como pagado", async () => {
    const res = await POST(postBody({ questionId: 100 }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.charged).toBe(true)
    expect(consumeToken).toHaveBeenCalledOnce()
    expect(db.userAiPaid.create).toHaveBeenCalledOnce()
  })

  it("segunda vez (user ya pagó): NO consume token", async () => {
    vi.mocked(db.userAiPaid.findFirst).mockResolvedValue({
      id: 1, userId: 1, questionId: 100, withImage: false, attemptId: null, paidAt: new Date(),
    } as never)

    const res = await POST(postBody({ questionId: 100 }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.charged).toBe(false)
    expect(consumeToken).not.toHaveBeenCalled()
    // No reinserta (el pago ya estaba)
    expect(db.userAiPaid.create).not.toHaveBeenCalled()
  })

  it("Fase 79: scope per-attempt — pagado en attempt 5 NO exime de attempt 6", async () => {
    // Llamada 1: usuario pidió IA dentro del attempt 5
    vi.mocked(db.userAiPaid.findFirst).mockImplementation((async (args: { where?: { attemptId?: number | null } }) => {
      if (args?.where?.attemptId === 5) {
        return { id: 1, userId: 1, questionId: 100, withImage: false, attemptId: 5, paidAt: new Date() } as never
      }
      return null  // no encontrado para attempt 6
    }) as never)

    const resA = await POST(postBody({ questionId: 100, attemptId: 5 }))
    expect((await resA.json()).charged).toBe(false)
    expect(consumeToken).not.toHaveBeenCalled()

    // Llamada 2: mismo user + misma pregunta pero attempt 6 (test repetido)
    vi.mocked(consumeToken).mockClear()
    const resB = await POST(postBody({ questionId: 100, attemptId: 6 }))
    expect((await resB.json()).charged).toBe(true)
    expect(consumeToken).toHaveBeenCalledOnce()
  })

  it("si el user pagó SIN attemptId (modo práctica), un attempt sí cobra", async () => {
    // Práctica = attemptId: null
    vi.mocked(db.userAiPaid.findFirst).mockImplementation((async (args: { where?: { attemptId?: number | null } }) => {
      if (args?.where?.attemptId === null) {
        return { id: 1, userId: 1, questionId: 100, withImage: false, attemptId: null, paidAt: new Date() } as never
      }
      return null
    }) as never)

    // El attempt 5 SÍ cobra (scope distinto)
    const res = await POST(postBody({ questionId: 100, attemptId: 5 }))
    expect((await res.json()).charged).toBe(true)
    expect(consumeToken).toHaveBeenCalledOnce()
  })

  it("cuota agotada → 429", async () => {
    vi.mocked(consumeToken).mockResolvedValue(null)  // null = sin quota
    const res = await POST(postBody({ questionId: 100 }))
    expect(res.status).toBe(429)
  })

  it("sin sesión → 401", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null as never)
    const res = await POST(postBody({ questionId: 100 }))
    expect(res.status).toBe(401)
  })

  it("body inválido → 400", async () => {
    const res = await POST(postBody({ questionId: "no es número" }))
    expect(res.status).toBe(400)
  })

  it("Fase 98: Gemini 429 → 503 + code 'ai_unavailable' + reembolso", async () => {
    // Forzar cache miss para que SÍ se llame a Gemini
    vi.mocked(db.aICacheEntry.findUnique).mockResolvedValue(null)
    vi.mocked(db.question.findUnique).mockResolvedValue({
      id: 100,
      enunciado:   "x",
      explicacion: "y",
      codigoTema:  null,
      imagen:      null,
      options: [
        { id: 1, letra: "A", texto: "a", isCorrect: true },
        { id: 2, letra: "B", texto: "b", isCorrect: false },
      ],
    } as never)
    // Gemini devuelve 429
    vi.mocked(explainQuestion).mockRejectedValueOnce(
      new AIProviderError("gemini", 429, "Gemini 429: quota exceeded")
    )

    const res = await POST(postBody({ questionId: 100 }))
    const body = await res.json()
    expect(res.status).toBe(503)
    expect(body.code).toBe("ai_unavailable")
    expect(body.error).toMatch(/no está disponible/i)
    // Reembolso: el token consumido se devuelve
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data:  { aiTokensUsed: { decrement: 1 } },
      })
    )
  })

  it("Fase 98: Gemini 500 → 502 con code 'ai_server_error'", async () => {
    vi.mocked(db.aICacheEntry.findUnique).mockResolvedValue(null)
    vi.mocked(db.question.findUnique).mockResolvedValue({
      id: 100,
      enunciado: "x", explicacion: "y", codigoTema: null, imagen: null,
      options: [
        { id: 1, letra: "A", texto: "a", isCorrect: true },
        { id: 2, letra: "B", texto: "b", isCorrect: false },
      ],
    } as never)
    vi.mocked(explainQuestion).mockRejectedValueOnce(
      new AIProviderError("gemini", 500, "Gemini 500: internal")
    )

    const res = await POST(postBody({ questionId: 100 }))
    const body = await res.json()
    expect(res.status).toBe(502)
    expect(body.code).toBe("ai_server_error")
    // Mensaje amigable, NO el err.message crudo
    expect(body.error).not.toMatch(/internal/i)
  })

  it("Fase 104: Gemini 400 API_KEY_INVALID → 503 con code 'ai_misconfigured'", async () => {
    vi.mocked(db.aICacheEntry.findUnique).mockResolvedValue(null)
    vi.mocked(db.question.findUnique).mockResolvedValue({
      id: 100,
      enunciado: "x", explicacion: "y", codigoTema: null, imagen: null,
      options: [
        { id: 1, letra: "A", texto: "a", isCorrect: true },
        { id: 2, letra: "B", texto: "b", isCorrect: false },
      ],
    } as never)
    vi.mocked(explainQuestion).mockRejectedValueOnce(
      new AIProviderError(
        "gemini",
        400,
        'Gemini 400: { "error": { "code": 400, "message": "API key expired. Please renew the API key.", "status": "INVALID_ARGUMENT", "details": [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "API_KEY_INVALID" }] } }'
      )
    )

    const res = await POST(postBody({ questionId: 100 }))
    const body = await res.json()
    expect(res.status).toBe(503)
    expect(body.code).toBe("ai_misconfigured")
    // NUNCA filtrar el JSON crudo de Google al usuario
    expect(body.error).not.toMatch(/API_KEY_INVALID/)
    expect(body.error).not.toMatch(/googleapis/)
    expect(body.error).toMatch(/administrador|configura/i)
  })

  it("Fase 104: Gemini 401 → 503 con code 'ai_misconfigured'", async () => {
    vi.mocked(db.aICacheEntry.findUnique).mockResolvedValue(null)
    vi.mocked(db.question.findUnique).mockResolvedValue({
      id: 100,
      enunciado: "x", explicacion: "y", codigoTema: null, imagen: null,
      options: [
        { id: 1, letra: "A", texto: "a", isCorrect: true },
        { id: 2, letra: "B", texto: "b", isCorrect: false },
      ],
    } as never)
    vi.mocked(explainQuestion).mockRejectedValueOnce(
      new AIProviderError("groq", 401, "Groq 401: invalid_api_key")
    )

    const res = await POST(postBody({ questionId: 100 }))
    const body = await res.json()
    expect(res.status).toBe(503)
    expect(body.code).toBe("ai_misconfigured")
  })

  it("Fase 104: Gemini 400 sin API_KEY → 502 con code 'ai_bad_request'", async () => {
    vi.mocked(db.aICacheEntry.findUnique).mockResolvedValue(null)
    vi.mocked(db.question.findUnique).mockResolvedValue({
      id: 100,
      enunciado: "x", explicacion: "y", codigoTema: null, imagen: null,
      options: [
        { id: 1, letra: "A", texto: "a", isCorrect: true },
        { id: 2, letra: "B", texto: "b", isCorrect: false },
      ],
    } as never)
    vi.mocked(explainQuestion).mockRejectedValueOnce(
      new AIProviderError("gemini", 400, "Gemini 400: bad prompt format")
    )

    const res = await POST(postBody({ questionId: 100 }))
    const body = await res.json()
    expect(res.status).toBe(502)
    expect(body.code).toBe("ai_bad_request")
  })

  it("Fase 51: cobra aunque haya cache hit (primera vez)", async () => {
    // Cache hit (no llamamos a Gemini) pero igual cobramos porque user nunca pagó
    const res = await POST(postBody({ questionId: 100 }))
    const body = await res.json()
    expect(body.cached).toBe(true)
    expect(body.charged).toBe(true)
    expect(explainQuestion).not.toHaveBeenCalled()  // confirmamos que NO se llamó a Gemini
    expect(consumeToken).toHaveBeenCalledOnce()      // pero sí se cobró
  })
})

describe("/api/ai/explain GET — comprobación sin cobrar", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockResolvedValue(fakeUser as never)
    vi.mocked(consumeToken).mockReset()
  })

  it("no consume token nunca", async () => {
    vi.mocked(db.userAiPaid.findFirst).mockResolvedValue({
      id: 1, userId: 1, questionId: 100, withImage: false, attemptId: null, paidAt: new Date(),
    } as never)
    vi.mocked(db.aICacheEntry.findUnique).mockResolvedValue(fakeCacheRow as never)

    const res = await GET(getReq("questionId=100"))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.alreadyPaid).toBe(true)
    expect(body.result).toBeDefined()
    expect(consumeToken).not.toHaveBeenCalled()
  })

  it("alreadyPaid:false si el user no ha pagado", async () => {
    vi.mocked(db.userAiPaid.findFirst).mockResolvedValue(null)

    const res = await GET(getReq("questionId=100"))
    const body = await res.json()
    expect(body.alreadyPaid).toBe(false)
  })

  it("alreadyPaid:false (no rompe) si el user pagó pero la cache desapareció", async () => {
    vi.mocked(db.userAiPaid.findFirst).mockResolvedValue({
      id: 1, userId: 1, questionId: 100, withImage: false, attemptId: null, paidAt: new Date(),
    } as never)
    vi.mocked(db.aICacheEntry.findUnique).mockResolvedValue(null)

    const res = await GET(getReq("questionId=100"))
    const body = await res.json()
    expect(body.alreadyPaid).toBe(false)
  })

  it("respeta el scope per-attempt", async () => {
    vi.mocked(db.userAiPaid.findFirst).mockImplementation((async (args: { where?: { attemptId?: number | null } }) => {
      if (args?.where?.attemptId === 5) {
        return { id: 1 } as never
      }
      return null
    }) as never)
    vi.mocked(db.aICacheEntry.findUnique).mockResolvedValue(fakeCacheRow as never)

    // GET con attemptId=5 → encuentra pago
    const resA = await GET(getReq("questionId=100&attemptId=5"))
    expect((await resA.json()).alreadyPaid).toBe(true)

    // GET con attemptId=6 → no encuentra
    const resB = await GET(getReq("questionId=100&attemptId=6"))
    expect((await resB.json()).alreadyPaid).toBe(false)
  })
})
