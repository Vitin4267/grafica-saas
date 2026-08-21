-- AlterTable
ALTER TABLE "orcamentos" ADD COLUMN     "prazoEntregaEstimadoDias" INTEGER,
ADD COLUMN     "validoAteEm" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "parametros_grafica" ADD COLUMN     "diasValidadeOrcamentoPadrao" INTEGER DEFAULT 15;

