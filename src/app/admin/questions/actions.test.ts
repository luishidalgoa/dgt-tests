import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAdmin:           vi.fn(),
  questionFindUnique:     vi.fn(),
  optionFindMany:         vi.fn(),
  questionUpdate:         vi.fn(),
  optionUpdate:           vi.fn(),
  aiCacheDeleteMany:      vi.fn(),
  reportUpdateMany:       vi.fn(),
  transaction:            vi.fn(),
  revalidatePath:         vi.fn(),
}))

vi.mock("@/lib/adminGuard", () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock("next/cache",        () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/db", () => ({
  db: {
    question: {
      findUnique: mocks.questionFindUnique,
      update:     mocks.questionUpdate,
    },
    option: {
      findMany: mocks.optionFindMany,
      update:   mocks.optionUpdate,
    },
    aICacheEntry: {
      deleteMany: mocks.aiCacheDeleteMany,
    },
    questionReport: {
      updateMany: mocks.reportUpdateMany,
    },
    $transaction: mocks.transaction,
  },
}))

import { updateQuestionAction } from "./actions"

function fd(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

const STANDARD_OPTIONS = [
  { id: 1, texto: "Sí, siempre",    isCorrect: true  },
  { id: 2, texto: "No, jamás",       isCorrect: false },
  { id: 3, texto: "Solo si llueve",  isCorrect: false },
]

describe("updateQuestionAction", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset?.())
    mocks.requireAdmin.mockResolvedValue({ id: 42, role: "ADMIN" })
    mocks.questionFindUnique.mockImplementation(async ({ include }) => {
      // Primera llamada (la de validación de pertenencia) incluye options.
      if (include?.options) {
        return {
          id:        1,
          enunciado: "Pregunta original",
          options:   [{ id: 1 }, { id: 2 }, { id: 3 }],
        }
      }
      // Segunda llamada (la del slug canónico) incluye testQuestions.
      return {
        testQuestions: [{ test: { category: { slug: "permiso-b" } } }],
      }
    })
    mocks.optionFindMany.mockResolvedValue([
      { id: 1, texto: "Sí, siempre",    isCorrect: true  },
      { id: 2, texto: "No, jamás",       isCorrect: false },
      { id: 3, texto: "Solo si llueve",  isCorrect: false },
    ])
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({
        question: { update: mocks.questionUpdate },
        option:   { update: mocks.optionUpdate },
      })
    })
    mocks.aiCacheDeleteMany.mockResolvedValue({ count: 0 })
    mocks.reportUpdateMany.mockResolvedValue({ count: 0 })
    mocks.questionUpdate.mockResolvedValue({})
    mocks.optionUpdate.mockResolvedValue({})
  })

  it("admin puede editar pregunta con cambios válidos", async () => {
    const res = await updateQuestionAction(fd({
      id:          "1",
      enunciado:   "Nuevo enunciado válido y suficientemente largo",
      explicacion: "Una explicación clara.",
      codigoTema:  "TC 1.2-5.3 (1-2.5)",
      imagen:      "320671.png",
      optionsJson: JSON.stringify(STANDARD_OPTIONS),
    }))
    expect(res.ok).toBe(true)
    expect(mocks.questionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 },
      data:  expect.objectContaining({
        enunciado:    "Nuevo enunciado válido y suficientemente largo",
        codigoTema:   "TC 1.2-5.3 (1-2.5)",
        imagen:       "320671.png",
        lastEditedBy: 42,
      }),
    }))
    // Como el enunciado cambió, debería invalidar el cache IA.
    expect(mocks.aiCacheDeleteMany).toHaveBeenCalledWith({ where: { questionId: 1 } })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/preguntas")
  })

  it("rechaza payload sin exactamente 1 opción correcta", async () => {
    const res = await updateQuestionAction(fd({
      id:          "1",
      enunciado:   "Enunciado suficientemente largo para pasar",
      explicacion: "Explicación.",
      codigoTema:  "",
      imagen:      "",
      optionsJson: JSON.stringify([
        { id: 1, texto: "A", isCorrect: true },
        { id: 2, texto: "B", isCorrect: true },
        { id: 3, texto: "C", isCorrect: false },
      ]),
    }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/correcta/i)
    expect(mocks.questionUpdate).not.toHaveBeenCalled()
  })

  it("rechaza opciones que no pertenecen a la pregunta", async () => {
    const res = await updateQuestionAction(fd({
      id:          "1",
      enunciado:   "Enunciado válido y suficientemente largo de verdad",
      explicacion: "Explicación.",
      codigoTema:  "",
      imagen:      "",
      optionsJson: JSON.stringify([
        { id: 999, texto: "X", isCorrect: true },
        { id: 2,   texto: "B", isCorrect: false },
        { id: 3,   texto: "C", isCorrect: false },
      ]),
    }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/no pertenece/i)
    expect(mocks.questionUpdate).not.toHaveBeenCalled()
  })

  it("non-admin: requireAdmin tira notFound() → action rebota", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("NEXT_NOT_FOUND"))
    await expect(
      updateQuestionAction(fd({
        id:          "1",
        enunciado:   "...",
        explicacion: "...",
        codigoTema:  "",
        imagen:      "",
        optionsJson: "[]",
      })),
    ).rejects.toThrow("NEXT_NOT_FOUND")
    expect(mocks.questionUpdate).not.toHaveBeenCalled()
  })

  it("normaliza codigoTema/imagen vacíos a null", async () => {
    await updateQuestionAction(fd({
      id:          "1",
      enunciado:   "Enunciado correcto y suficientemente largo",
      explicacion: "Explicación.",
      codigoTema:  "",
      imagen:      "   ",
      optionsJson: JSON.stringify(STANDARD_OPTIONS),
    }))
    expect(mocks.questionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        codigoTema: null,
        imagen:     null,
      }),
    }))
  })

  it("marca automáticamente como fixed los reports pending de la pregunta", async () => {
    mocks.reportUpdateMany.mockResolvedValue({ count: 2 })
    await updateQuestionAction(fd({
      id:          "1",
      enunciado:   "Enunciado nuevo y suficientemente largo de verdad",
      explicacion: "Explicación.",
      codigoTema:  "TC 1",
      imagen:      "",
      optionsJson: JSON.stringify(STANDARD_OPTIONS),
    }))
    expect(mocks.reportUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { questionId: 1, status: "pending" },
      data:  expect.objectContaining({ status: "fixed", reviewedBy: 42 }),
    }))
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/reports")
  })

  it("no invalida cache IA si nada cambió", async () => {
    // El mock devuelve enunciado igual y opciones iguales → no debería
    // borrar AICacheEntry.
    await updateQuestionAction(fd({
      id:          "1",
      enunciado:   "Pregunta original",                              // igual
      explicacion: "Cambia solo la explicación, eso no toca cache.",
      codigoTema:  "TC 1",
      imagen:      "",
      optionsJson: JSON.stringify(STANDARD_OPTIONS),               // iguales
    }))
    expect(mocks.aiCacheDeleteMany).not.toHaveBeenCalled()
  })
})
