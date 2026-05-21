/*
  Warnings:

  - Added the required column `userId` to the `exam_attempts` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_exam_attempts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "testId" INTEGER,
    "mode" TEXT NOT NULL DEFAULT 'normal',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "score" INTEGER,
    "total" INTEGER NOT NULL,
    CONSTRAINT "exam_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "exam_attempts_testId_fkey" FOREIGN KEY ("testId") REFERENCES "tests" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_exam_attempts" ("finishedAt", "id", "mode", "score", "startedAt", "testId", "total") SELECT "finishedAt", "id", "mode", "score", "startedAt", "testId", "total" FROM "exam_attempts";
DROP TABLE "exam_attempts";
ALTER TABLE "new_exam_attempts" RENAME TO "exam_attempts";
CREATE INDEX "exam_attempts_userId_startedAt_idx" ON "exam_attempts"("userId", "startedAt");
CREATE INDEX "exam_attempts_userId_testId_idx" ON "exam_attempts"("userId", "testId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
