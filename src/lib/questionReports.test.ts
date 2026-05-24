import { describe, it, expect } from "vitest"
import {
  REPORT_TYPES,
  REPORT_TYPE_VALUES,
  REPORT_STATUSES,
  isReportType,
  isReportStatus,
  reportTypeLabel,
} from "./questionReports"

describe("questionReports helpers", () => {
  it("REPORT_TYPE_VALUES coincide con REPORT_TYPES", () => {
    expect(REPORT_TYPE_VALUES).toEqual(REPORT_TYPES.map((t) => t.value))
  })

  it("isReportType acepta sólo los valores del catálogo", () => {
    for (const t of REPORT_TYPE_VALUES) {
      expect(isReportType(t)).toBe(true)
    }
    expect(isReportType("hack")).toBe(false)
    expect(isReportType("")).toBe(false)
  })

  it("isReportStatus acepta sólo los 4 status oficiales", () => {
    for (const s of REPORT_STATUSES) {
      expect(isReportStatus(s)).toBe(true)
    }
    expect(isReportStatus("trashed")).toBe(false)
    expect(isReportStatus("")).toBe(false)
  })

  it("reportTypeLabel devuelve el label si existe, si no el value", () => {
    expect(reportTypeLabel("wrong_answer")).toBe("Respuesta marcada incorrecta")
    expect(reportTypeLabel("xxx")).toBe("xxx")
  })
})
