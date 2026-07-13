-- AlterTable
ALTER TABLE "assinatura_grafica" ADD COLUMN     "cortesia" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "superAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Normaliza a conta do proprio dono da plataforma, que ja estava nesse
-- estado exato (ATIVA, sem Stripe) desde antes desta feature existir.
UPDATE "assinatura_grafica" SET "cortesia" = true
  WHERE status = 'ATIVA' AND "stripeSubscriptionId" IS NULL;

UPDATE "usuarios" SET "superAdmin" = true
  WHERE email = 'ferraretovitor@gmail.com';
