-- CreateTable
CREATE TABLE "parties" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "hostUserId" INTEGER NOT NULL,
    "categoryId" INTEGER,
    "totalQuestions" INTEGER NOT NULL,
    "questionIds" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "parties_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "parties_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "party_players" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "partyId" INTEGER NOT NULL,
    "userId" INTEGER,
    "guestName" TEXT,
    "guestToken" TEXT,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "party_players_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "party_players_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "party_answers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "partyPlayerId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "selectedOptionId" INTEGER,
    "isCorrect" BOOLEAN NOT NULL,
    "timeMs" INTEGER NOT NULL,
    "answeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "party_answers_partyPlayerId_fkey" FOREIGN KEY ("partyPlayerId") REFERENCES "party_players" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "party_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "parties_code_key" ON "parties"("code");

-- CreateIndex
CREATE INDEX "parties_code_idx" ON "parties"("code");

-- CreateIndex
CREATE INDEX "parties_hostUserId_idx" ON "parties"("hostUserId");

-- CreateIndex
CREATE UNIQUE INDEX "party_players_guestToken_key" ON "party_players"("guestToken");

-- CreateIndex
CREATE INDEX "party_players_partyId_idx" ON "party_players"("partyId");

-- CreateIndex
CREATE INDEX "party_answers_partyPlayerId_idx" ON "party_answers"("partyPlayerId");
