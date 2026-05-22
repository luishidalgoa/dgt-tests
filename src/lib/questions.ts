/**
 * Helpers Prisma para filtrar qué preguntas son VISIBLES a los usuarios.
 *
 * Reglas:
 *   - Preguntas humanas (aiGenerated=false): siempre visibles.
 *   - Preguntas IA-generadas (aiGenerated=true):
 *       - aiApproved=true  → visibles
 *       - aiApproved=null  → pendientes de review en /admin/review-questions (NO visibles)
 *       - aiApproved=false → descartadas (NO visibles)
 *
 * Aplicado en:
 *   - Generación de exámenes oficiales (/[categoria]/[testNum])
 *   - Práctica por tema (/temas/[prefix][/inner])
 *   - Test de errores (/test-errores)
 *   - Modo competir (/api/parties/[code]/questions)
 *   - Estadísticas y conteos del dashboard / /stats
 *
 * NO se aplica en:
 *   - /admin/review-questions (justo necesitamos ver las pendientes)
 *   - Scripts admin que recorren TODO (ej. cleanup)
 */

import { Prisma } from "@prisma/client"

/**
 * WHERE-fragment Prisma para preguntas visibles a usuarios.
 *
 * Uso:
 *   db.question.findMany({ where: { ...QUESTION_VISIBLE_WHERE, codigoTema: ... } })
 *   db.question.count({ where: { ...QUESTION_VISIBLE_WHERE } })
 *
 * Lógica: NOT (aiGenerated AND NOT aiApproved).
 * Expresado positivamente: aiGenerated=false OR aiApproved=true.
 */
export const QUESTION_VISIBLE_WHERE = {
  OR: [
    { aiGenerated: false },
    { aiGenerated: true, aiApproved: true },
  ],
} satisfies Prisma.QuestionWhereInput

/**
 * Para queries SQL raw donde no podemos usar Prisma WHERE. El alias `q`
 * debe ser el de la tabla questions.
 *
 *   `WHERE ... ${SQL_QUESTION_VISIBLE_AND}`
 */
export const SQL_QUESTION_VISIBLE_AND =
  `AND (q.aiGenerated = 0 OR q.aiApproved = 1)`

/**
 * Inverso de QUESTION_VISIBLE_WHERE: preguntas que deben revisarse.
 * Usado por /admin/review-questions.
 */
export const QUESTION_PENDING_REVIEW_WHERE = {
  aiGenerated: true,
  aiApproved:  null,
} satisfies Prisma.QuestionWhereInput

/**
 * Preguntas IA que YA fueron aprobadas y por tanto ya están en circulación.
 * Usado por /admin/ai-questions para auditar lo que estamos sirviendo.
 */
export const QUESTION_APPROVED_AI_WHERE = {
  aiGenerated: true,
  aiApproved:  true,
} satisfies Prisma.QuestionWhereInput
