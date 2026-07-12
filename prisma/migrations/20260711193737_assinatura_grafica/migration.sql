-- CreateEnum
CREATE TYPE "StatusAssinatura" AS ENUM ('TRIALING', 'ATIVA', 'INADIMPLENTE', 'CANCELADA');

-- CreateTable
CREATE TABLE "assinatura_grafica" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "status" "StatusAssinatura" NOT NULL DEFAULT 'TRIALING',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "trialExpiraEm" TIMESTAMP(3),
    "periodoAtualExpiraEm" TIMESTAMP(3),
    "canceladaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assinatura_grafica_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assinatura_grafica_graficaId_key" ON "assinatura_grafica"("graficaId");

-- CreateIndex
CREATE UNIQUE INDEX "assinatura_grafica_stripeCustomerId_key" ON "assinatura_grafica"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "assinatura_grafica_stripeSubscriptionId_key" ON "assinatura_grafica"("stripeSubscriptionId");

-- AddForeignKey
ALTER TABLE "assinatura_grafica" ADD CONSTRAINT "assinatura_grafica_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: toda gráfica já cadastrada antes desta feature existir ganha
-- status ATIVA direto (grandfather) — ninguém trava por uma cobrança que
-- não existia quando se cadastrou. Gráficas novas a partir daqui nascem em
-- TRIALING via registro/actions.ts. Id gerado sem depender de extensão
-- (pgcrypto/uuid-ossp) — só precisa ser único, não seguir o formato cuid
-- (mesmo padrão já usado no backfill de "Prensa Principal").
INSERT INTO "assinatura_grafica" ("id", "graficaId", "status", "updatedAt")
SELECT substr(md5(random()::text || clock_timestamp()::text || "id"), 1, 25), "id", 'ATIVA', now()
FROM "graficas";

