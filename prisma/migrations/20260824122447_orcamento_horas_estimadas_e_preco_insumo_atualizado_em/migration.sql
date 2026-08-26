-- AlterTable
ALTER TABLE "orcamento_itens" ADD COLUMN     "horasEstimadas" DECIMAL(8,2);

-- AlterTable
ALTER TABLE "itens_grafica" ADD COLUMN     "precoCompraAtualizadoEm" TIMESTAMP(3);
