-- Contas a receber: par simétrico de Despesa, mas pro dinheiro que o CLIENTE
-- ainda deve (parcelas/pagamentos esperados de um Orcamento aprovado).
-- Tabela nova apenas, nenhuma mudança em tabela existente.

-- CreateEnum
CREATE TYPE "StatusContaReceber" AS ENUM ('PENDENTE', 'RECEBIDO', 'CANCELADO');

-- CreateTable
CREATE TABLE "contas_a_receber" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "orcamentoId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "status" "StatusContaReceber" NOT NULL DEFAULT 'PENDENTE',
    "recebidoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contas_a_receber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contas_a_receber_graficaId_status_vencimento_idx" ON "contas_a_receber"("graficaId", "status", "vencimento");

-- CreateIndex
CREATE INDEX "contas_a_receber_orcamentoId_idx" ON "contas_a_receber"("orcamentoId");

-- AddForeignKey
ALTER TABLE "contas_a_receber" ADD CONSTRAINT "contas_a_receber_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_a_receber" ADD CONSTRAINT "contas_a_receber_orcamentoId_fkey" FOREIGN KEY ("orcamentoId") REFERENCES "orcamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
