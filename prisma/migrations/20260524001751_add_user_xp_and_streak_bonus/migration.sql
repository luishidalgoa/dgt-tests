-- Gamificación: XP + nivel del usuario.
--
-- Añade dos columnas a `users`:
--   - xp:                    contador entero de puntos de experiencia. El
--                            nivel se deriva en src/lib/xp.ts:getLevel().
--                            Usuarios existentes arrancan en 0 (lvl-0,
--                            llama apagada).
--   - lastWeekStreakBonusAt: timestamp del último bonus "racha 7 días"
--                            otorgado, para evitar pagarlo más de una vez
--                            por ventana semanal. NULL = nunca recibido.
--
-- SQLite admite ADD COLUMN sin recrear la tabla siempre que la columna
-- nueva sea NULLable o tenga DEFAULT constante — ambos casos cumplen.

ALTER TABLE "users" ADD COLUMN "xp" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "lastWeekStreakBonusAt" DATETIME;
