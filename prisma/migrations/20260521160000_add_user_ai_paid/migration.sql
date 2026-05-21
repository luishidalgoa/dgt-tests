-- Registro per-user de "este usuario ya pagó por la explicación IA de
-- esta pregunta". El cobro solo ocurre la primera vez; las siguientes
-- visualizaciones son gratis para ese usuario.
--
-- Idempotente y compatible con Turso (CREATE TABLE simple, sin
-- redefinición). Las FKs siguen el patrón del resto del schema.
CREATE TABLE "user_ai_paid" (
  "id"         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId"     INTEGER NOT NULL,
  "questionId" INTEGER NOT NULL,
  "withImage"  BOOLEAN NOT NULL DEFAULT false,
  "paidAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_ai_paid_userId_fkey"     FOREIGN KEY ("userId")     REFERENCES "users"("id")     ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_ai_paid_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "user_ai_paid_userId_questionId_withImage_key" ON "user_ai_paid"("userId", "questionId", "withImage");
CREATE INDEX "user_ai_paid_userId_idx" ON "user_ai_paid"("userId");
