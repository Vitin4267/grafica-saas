-- AlterTable
ALTER TABLE "orcamentos" ADD COLUMN     "enviadoEm" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "parametros_grafica" ADD COLUMN     "diasAlertaOrcamentoParado" INTEGER NOT NULL DEFAULT 5;

-- CreateIndex
CREATE INDEX "orcamentos_graficaId_status_enviadoEm_idx" ON "orcamentos"("graficaId", "status", "enviadoEm");
