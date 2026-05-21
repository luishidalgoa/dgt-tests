-- CreateTable
CREATE TABLE "ai_cache_entries" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "questionId" INTEGER NOT NULL,
    "withImage" BOOLEAN NOT NULL DEFAULT false,
    "payloadJson" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'gemini-flash-latest',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_cache_entries_questionId_withImage_key" ON "ai_cache_entries"("questionId", "withImage");
