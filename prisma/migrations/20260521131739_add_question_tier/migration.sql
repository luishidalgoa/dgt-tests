-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_questions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "externalId" TEXT NOT NULL,
    "codigoTema" TEXT,
    "enunciado" TEXT NOT NULL,
    "explicacion" TEXT NOT NULL,
    "imagen" TEXT,
    "tier" TEXT NOT NULL DEFAULT 'PRO'
);
INSERT INTO "new_questions" ("codigoTema", "enunciado", "explicacion", "externalId", "id", "imagen") SELECT "codigoTema", "enunciado", "explicacion", "externalId", "id", "imagen" FROM "questions";
DROP TABLE "questions";
ALTER TABLE "new_questions" RENAME TO "questions";
CREATE UNIQUE INDEX "questions_externalId_key" ON "questions"("externalId");
CREATE INDEX "questions_tier_idx" ON "questions"("tier");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
