-- AlterTable: añadir columna email opcional + índice único
-- Nullable + nullable unique funcionan bien en SQLite/Turso sin redefinir
-- la tabla (los NULL no se consideran duplicados a efectos del UNIQUE).
ALTER TABLE "users" ADD COLUMN "email" TEXT;
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
