-- Cache del análisis IA de stats por usuario (Fase 110).
--
-- Uno por usuario (userId unique). Cada vez que el usuario pulsa
-- "Actualizar análisis" se regenera (cobrando 5 tokens) y sobrescribe
-- el anterior. El snapshot de totalAttempts/totalAnswers permite
-- devolverlo gratis si el alumno no ha hecho tests desde la última vez.

CREATE TABLE "user_ai_stats_analysis" (
  "id"             INTEGER  NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId"         INTEGER  NOT NULL,
  "payloadJson"    TEXT     NOT NULL,
  "totalAttempts"  INTEGER  NOT NULL,
  "totalAnswers"   INTEGER  NOT NULL,
  "correctAnswers" INTEGER  NOT NULL,
  "model"          TEXT,
  "createdAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_ai_stats_analysis_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "user_ai_stats_analysis_userId_key"
  ON "user_ai_stats_analysis" ("userId");
