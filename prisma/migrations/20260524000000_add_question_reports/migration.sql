-- Añade question_reports: incidencias reportadas por usuarios (logueados
-- o guests) sobre preguntas concretas. Las revisa el admin desde
-- /admin/reports.
--
--   userId      → null para guests; FK SetNull al borrar usuario
--                 para conservar la incidencia históricamente.
--   guestEmail  → opcional, sólo se rellena cuando userId es NULL.
--   type        → enum-like a nivel aplicación: "wrong_answer",
--                 "wrong_statement", "broken_image", "duplicate_options",
--                 "wrong_explanation", "other".
--   status      → "pending" (default) | "reviewed" | "fixed" | "dismissed".
--   reviewedBy  → id del admin que cerró el report; FK SetNull al borrar admin.

CREATE TABLE "question_reports" (
  "id"          INTEGER  NOT NULL PRIMARY KEY AUTOINCREMENT,
  "questionId"  INTEGER  NOT NULL,
  "userId"      INTEGER,
  "guestEmail"  TEXT,
  "type"        TEXT     NOT NULL,
  "comment"     TEXT,
  "status"      TEXT     NOT NULL DEFAULT 'pending',
  "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt"  DATETIME,
  "reviewedBy"  INTEGER,
  CONSTRAINT "question_reports_questionId_fkey"
    FOREIGN KEY ("questionId") REFERENCES "questions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "question_reports_status_createdAt_idx"
  ON "question_reports" ("status", "createdAt");

CREATE INDEX "question_reports_questionId_idx"
  ON "question_reports" ("questionId");
