-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "aiTokensUsed" INTEGER NOT NULL DEFAULT 0,
    "aiTokensMonth" TEXT NOT NULL DEFAULT '',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "subscriptionStatus" TEXT,
    "subscriptionPriceId" TEXT,
    "subscriptionCurrentPeriodEnd" DATETIME,
    "hasSeenWelcome" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_users" ("aiTokensMonth", "aiTokensUsed", "createdAt", "displayName", "id", "passwordHash", "username") SELECT "aiTokensMonth", "aiTokensUsed", "createdAt", "displayName", "id", "passwordHash", "username" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_stripeCustomerId_key" ON "users"("stripeCustomerId");
CREATE UNIQUE INDEX "users_stripeSubscriptionId_key" ON "users"("stripeSubscriptionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
