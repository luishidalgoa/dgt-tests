-- Convertir user_ai_stats_analysis a HISTORIAL (Fase 111):
--   - Quitar UNIQUE de userId (SQLite obliga a recrear la tabla).
--   - Añadir columna nullable contextJson para guardar topWeakBlocks snapshot.
--   - Añadir índice compuesto (userId, createdAt DESC) para listar rápido.
--
-- Preservamos los datos existentes (las filas únicas por usuario quedan
-- como el "primer análisis" del historial; contextJson queda NULL para
-- ellas, lo cual el código tolera).

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_user_ai_stats_analysis" (
  "id"             INTEGER  NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId"         INTEGER  NOT NULL,
  "payloadJson"    TEXT     NOT NULL,
  "contextJson"    TEXT,
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

INSERT INTO "new_user_ai_stats_analysis"
  ("id", "userId", "payloadJson", "totalAttempts", "totalAnswers", "correctAnswers", "model", "createdAt", "updatedAt")
SELECT
  "id", "userId", "payloadJson", "totalAttempts", "totalAnswers", "correctAnswers", "model", "createdAt", "updatedAt"
FROM "user_ai_stats_analysis";

DROP TABLE "user_ai_stats_analysis";
ALTER TABLE "new_user_ai_stats_analysis" RENAME TO "user_ai_stats_analysis";

CREATE INDEX "user_ai_stats_analysis_userId_createdAt_idx"
  ON "user_ai_stats_analysis" ("userId", "createdAt" DESC);

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
