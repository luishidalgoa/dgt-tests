-- Audit de ediciones manuales de preguntas desde /admin/questions.
--
-- Cuándo y quién editó por última vez. Solo guardamos la última edición
-- (igual patrón que AppConfig.updatedAt/updatedBy) — si en el futuro hace
-- falta historial completo, se añade una tabla QuestionEdit.
--
-- No tocamos las preguntas IA: aiReviewedAt/aiApproved siguen sirviendo
-- a su flujo de review. Estos campos son ortogonales a esa fase.

ALTER TABLE "questions" ADD COLUMN "lastEditedAt" DATETIME;
ALTER TABLE "questions" ADD COLUMN "lastEditedBy" INTEGER REFERENCES "users"("id") ON DELETE SET NULL;
