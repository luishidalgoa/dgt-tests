-- Tabla de configuración runtime para el panel admin.
-- Cosas que el admin puede cambiar sin redeploy: quotas, feature flags,
-- API keys cifradas con AES-256-GCM (APP_MASTER_KEY), textos UI…
--
-- key       = identificador, p.ej. "AI_TOKENS_PRO", "FEATURE_COMPETIR"
-- value     = JSON string si encrypted=false, envelope si encrypted=true
-- encrypted = 0/1 (boolean SQLite)
-- updatedBy = id del admin que cambió, null si seed inicial

CREATE TABLE "app_config" (
  "key"       TEXT NOT NULL PRIMARY KEY,
  "value"     TEXT NOT NULL,
  "encrypted" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" INTEGER REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
