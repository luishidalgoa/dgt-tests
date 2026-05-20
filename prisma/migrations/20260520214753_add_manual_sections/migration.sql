-- CreateTable
CREATE TABLE "manual_sections" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "temaCode" TEXT NOT NULL,
    "temaName" TEXT NOT NULL,
    "subtemaCode" TEXT NOT NULL,
    "subtemaName" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "pages" TEXT NOT NULL,
    "totalPages" INTEGER NOT NULL,
    "pdfFilename" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "manual_sections_subtemaCode_key" ON "manual_sections"("subtemaCode");

-- CreateIndex
CREATE INDEX "manual_sections_subtemaCode_idx" ON "manual_sections"("subtemaCode");

-- CreateIndex
CREATE INDEX "manual_sections_temaCode_idx" ON "manual_sections"("temaCode");
