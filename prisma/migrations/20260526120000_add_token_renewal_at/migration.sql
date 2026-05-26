-- Fecha de renovación de tokens IA por usuario.
--
-- Regla del sistema:
--   - Usuarios que NUNCA fueron PRO: la fecha se inicializa al aniversario
--     mensual de createdAt. Avanza mes a mes en aiQuota.ts cuando se accede
--     y la fecha ya ha pasado.
--   - Usuarios que SON o HAN SIDO PRO: la fecha la actualizan los webhooks
--     de Stripe a subscriptionCurrentPeriodEnd (active/renew) o expiry+1mes
--     (deleted).
--
-- Sistema antiguo (aiTokensMonth = "YYYY-MM") queda como columna legacy en
-- la tabla pero ya no se escribe. Se mantiene para tolerar caches de Prisma
-- client viejos en runtimes que aún no se han redeployado. Una migración
-- futura podrá dropearla cuando todos los entornos se hayan actualizado.
--
-- Nullable: los usuarios existentes verán NULL inicialmente. aiQuota.ts
-- los inicializa lazy (con backfill al primer acceso) según su createdAt
-- o estado de suscripción.

ALTER TABLE "users" ADD COLUMN "aiTokensRenewalAt" DATETIME;
