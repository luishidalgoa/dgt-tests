-- Refactor de la economía de XP:
--
-- La fase anterior introdujo `lastWeekStreakBonusAt` para un bonus único
-- al completar 7 días seguidos. Hemos cambiado el modelo: ahora se paga
-- un bonus DIARIO de tamaño progresivo según el día de racha
-- (5, 7, 10, 15, 20, 30, 50 → loop). Por tanto la columna pasa a
-- tener semántica "última vez que se pagó bonus diario" y se renombra
-- a `lastStreakBonusAt`.
--
-- SQLite 3.25+ soporta ALTER TABLE ... RENAME COLUMN sin recrear la
-- tabla. El @prisma/adapter-libsql que usa el proyecto va sobre libSQL
-- moderno, por lo que esto está soportado.
--
-- Los datos existentes (si los había, que en dev probablemente no) se
-- preservan tal cual con el nombre nuevo — la semántica es lo
-- suficientemente parecida (timestamp del último bonus de racha) como
-- para no requerir traducción.

ALTER TABLE "users" RENAME COLUMN "lastWeekStreakBonusAt" TO "lastStreakBonusAt";
