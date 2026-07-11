-- CreateTable
CREATE TABLE "prensas" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "custoHoraMaq" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "torres" INTEGER NOT NULL DEFAULT 4,
    "custoChapa" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "folhasAcerto" INTEGER NOT NULL DEFAULT 150,
    "tempoAcertoH" DECIMAL(6,4) NOT NULL DEFAULT 0.5,
    "custoMilheiroRod" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "rodagemMinima" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "perdaPercentPadrao" DECIMAL(5,4) NOT NULL DEFAULT 0.03,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prensas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prensas_graficaId_idx" ON "prensas"("graficaId");

-- CreateIndex
CREATE UNIQUE INDEX "prensas_graficaId_nome_key" ON "prensas"("graficaId", "nome");

-- AddForeignKey
ALTER TABLE "prensas" ADD CONSTRAINT "prensas_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: uma "Prensa Principal" por gráfica, copiando os 8 valores de máquina
-- que hoje vivem em parametros_grafica, pra nenhuma gráfica existente perder dado
-- ao trocarmos pro modelo de múltiplas prensas. Id gerado sem depender de
-- extensão (pgcrypto/uuid-ossp) — só precisa ser único, não seguir o formato cuid.
INSERT INTO "prensas" (
    "id", "graficaId", "nome", "ativa",
    "custoHoraMaq", "torres", "custoChapa", "folhasAcerto",
    "tempoAcertoH", "custoMilheiroRod", "rodagemMinima", "perdaPercentPadrao",
    "createdAt", "updatedAt"
)
SELECT
    substr(md5(random()::text || clock_timestamp()::text || "graficaId"), 1, 25),
    "graficaId", 'Prensa Principal', true,
    "custoHoraMaq", "torres", "custoChapa", "folhasAcerto",
    "tempoAcertoH", "custoMilheiroRod", "rodagemMinima", "perdaPercentPadrao",
    now(), now()
FROM "parametros_grafica";

-- AlterTable
ALTER TABLE "itens_grafica" ADD COLUMN     "prensaId" TEXT;

-- AddForeignKey
ALTER TABLE "itens_grafica" ADD CONSTRAINT "itens_grafica_prensaId_fkey" FOREIGN KEY ("prensaId") REFERENCES "prensas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Liga qualquer produto OFFSET já existente à "Prensa Principal" recém-criada da
-- sua própria gráfica (hoje o seed não tem nenhum produto OFFSET — isso é uma
-- rede de segurança pra dados criados manualmente via UI em sessões anteriores).
UPDATE "itens_grafica"
SET "prensaId" = "prensas"."id"
FROM "prensas"
WHERE "prensas"."graficaId" = "itens_grafica"."graficaId"
  AND "prensas"."nome" = 'Prensa Principal'
  AND "itens_grafica"."modeloCalculo" = 'OFFSET';

-- AlterTable
ALTER TABLE "parametros_grafica" DROP COLUMN "custoChapa",
DROP COLUMN "custoHoraMaq",
DROP COLUMN "custoMilheiroRod",
DROP COLUMN "folhasAcerto",
DROP COLUMN "perdaPercentPadrao",
DROP COLUMN "rodagemMinima",
DROP COLUMN "tempoAcertoH",
DROP COLUMN "torres";
