-- Añade los campos para preguntas generadas por IA (Fase 107).
--
--   aiGenerated  → marca la pregunta como sintética; defaults a 0 (humana)
--                  para no romper las existentes.
--   aiModel      → modelo que la generó (ej. "gemini-2.5-flash") — auditoría.
--   aiReviewedAt → cuándo se revisó (null = pendiente).
--   aiApproved   → null = pendiente, 1 = aprobada visible, 0 = descartada.
--
-- El filtro QUESTION_VISIBLE_WHERE excluye preguntas IA sin aprobar, por lo
-- que las preguntas humanas (todas hasta hoy) siguen siendo visibles sin
-- cambios. Las generadas se mantienen invisibles hasta que un admin las
-- apruebe desde /admin/review-questions.

ALTER TABLE "questions" ADD COLUMN "aiGenerated"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "questions" ADD COLUMN "aiModel"      TEXT;
ALTER TABLE "questions" ADD COLUMN "aiReviewedAt" DATETIME;
ALTER TABLE "questions" ADD COLUMN "aiApproved"   BOOLEAN;

-- Acelera el filtro "preguntas visibles a usuario" en /temas, /test-errores, etc.
CREATE INDEX "questions_aiGenerated_aiApproved_idx" ON "questions" ("aiGenerated", "aiApproved");
