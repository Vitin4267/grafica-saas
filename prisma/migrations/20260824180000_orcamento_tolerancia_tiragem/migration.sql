-- AlterTable
ALTER TABLE "parametros_grafica" ADD COLUMN     "toleranciaTiragemPadraoPercent" DECIMAL(5,2) DEFAULT 10;

-- AlterTable
ALTER TABLE "orcamentos" ADD COLUMN     "toleranciaTiragemPercent" DECIMAL(5,2);
