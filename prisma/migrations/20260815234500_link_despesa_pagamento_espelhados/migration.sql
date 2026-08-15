-- AlterTable
ALTER TABLE "contas_a_receber" ADD COLUMN     "pagamentoId" TEXT;

-- AlterTable
ALTER TABLE "movimentacoes_conta_prepaga" ADD COLUMN     "despesaId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "contas_a_receber_pagamentoId_key" ON "contas_a_receber"("pagamentoId");

-- CreateIndex
CREATE UNIQUE INDEX "movimentacoes_conta_prepaga_despesaId_key" ON "movimentacoes_conta_prepaga"("despesaId");

-- AddForeignKey
ALTER TABLE "movimentacoes_conta_prepaga" ADD CONSTRAINT "movimentacoes_conta_prepaga_despesaId_fkey" FOREIGN KEY ("despesaId") REFERENCES "despesas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_a_receber" ADD CONSTRAINT "contas_a_receber_pagamentoId_fkey" FOREIGN KEY ("pagamentoId") REFERENCES "pagamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
