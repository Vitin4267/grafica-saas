-- AlterTable
ALTER TABLE "configuracoes_cliche_etiqueta" DROP COLUMN "custoClicheUnitario",
ADD COLUMN     "custoClichePorCm2" DECIMAL(12,4) NOT NULL;
