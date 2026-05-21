-- Añade attemptId opcional a user_ai_paid para que el pago de la IA se
-- pueda asociar a un intento concreto del examen:
--   - attemptId = NULL  → modo práctica / sin contexto. Un solo pago por
--                          (user, question, withImage) — sigue gratis para
--                          siempre como en Fase 77.
--   - attemptId = X     → pago atado a ese ExamAttempt. Re-ver el mismo
--                          attempt es gratis; un nuevo attempt del mismo
--                          test cobra otra vez.
--
-- Sustituimos el unique simple por dos partial unique indexes (uno para
-- cada caso). SQLite/Turso soportan partial indexes con WHERE.

ALTER TABLE "user_ai_paid" ADD COLUMN "attemptId" INTEGER REFERENCES "exam_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX "user_ai_paid_userId_questionId_withImage_key";

CREATE UNIQUE INDEX "user_ai_paid_practice_unique"
  ON "user_ai_paid"("userId", "questionId", "withImage")
  WHERE "attemptId" IS NULL;

CREATE UNIQUE INDEX "user_ai_paid_attempt_unique"
  ON "user_ai_paid"("userId", "attemptId", "questionId", "withImage")
  WHERE "attemptId" IS NOT NULL;

CREATE INDEX "user_ai_paid_attemptId_idx" ON "user_ai_paid"("attemptId");
