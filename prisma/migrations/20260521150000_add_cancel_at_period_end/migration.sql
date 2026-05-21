-- Añade el flag subscriptionCancelAtPeriodEnd al modelo User.
-- Si true → el usuario canceló pero sigue con acceso hasta
-- subscriptionCurrentPeriodEnd. Si false → renovará al final del periodo.
ALTER TABLE "users" ADD COLUMN "subscriptionCancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
