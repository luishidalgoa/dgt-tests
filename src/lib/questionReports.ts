/**
 * Catálogo y helpers para reportes de incidencias en preguntas
 * (QuestionReport). Compartido entre el endpoint POST, el form cliente y
 * el panel admin para garantizar coherencia de tipos y status.
 *
 * El "type" es enum-like: validado por zod tanto en el form como en el
 * endpoint, y mostrado al admin con su label en el panel /admin/reports.
 */

export const REPORT_TYPES = [
  { value: "wrong_answer",       label: "Respuesta marcada incorrecta" },
  { value: "wrong_statement",    label: "Errata en enunciado"          },
  { value: "broken_image",       label: "Imagen no carga"              },
  { value: "duplicate_options",  label: "Opciones repetidas"           },
  { value: "wrong_explanation",  label: "Explicación errónea"          },
  { value: "other",              label: "Otra"                         },
] as const

export type ReportType = (typeof REPORT_TYPES)[number]["value"]

export const REPORT_TYPE_VALUES = REPORT_TYPES.map((t) => t.value) as readonly ReportType[]

export function isReportType(value: string): value is ReportType {
  return (REPORT_TYPE_VALUES as readonly string[]).includes(value)
}

export function reportTypeLabel(value: string): string {
  return REPORT_TYPES.find((t) => t.value === value)?.label ?? value
}

export const REPORT_STATUSES = ["pending", "reviewed", "fixed", "dismissed"] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

export function isReportStatus(value: string): value is ReportStatus {
  return (REPORT_STATUSES as readonly string[]).includes(value)
}

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  pending:   "Pendiente",
  reviewed:  "Revisada",
  fixed:     "Arreglada",
  dismissed: "Descartada",
}

export const COMMENT_MAX_LENGTH = 1000
