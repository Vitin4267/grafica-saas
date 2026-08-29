-- Achado A8 da Parte 4 (Financeiro) da auditoria de abrangência (2026-08-29):
-- ContaReceber/Despesa eram tudo-ou-nada — a reconciliação entre Pagamento e
-- ContaReceber só casava em valor EXATO (comentário em registrarPagamento,
-- src/app/orcamento/[id]/actions.ts: "pagamento parcial ou com sobra não
-- mexe em nada"), e Despesa não tinha nenhum jeito de registrar um pagamento
-- parcial. Puramente aditivo: StatusContaReceber/StatusDespesa ganham
-- PARCIAL, e dois novos models guardam cada baixa/pagamento individual — o
-- saldo em aberto é sempre recalculado somando essas linhas (ver
-- src/lib/baixa-financeira.ts), nunca armazenado. Nenhuma coluna ou linha
-- existente é alterada; nenhum backfill necessário.
--
-- ADD VALUE não pode rodar na mesma transação que um comando que USA o valor
-- novo — aqui não usamos 'PARCIAL' em nenhum outro statement deste arquivo
-- (só CREATE TABLE/FK), então isso é seguro dentro da mesma migration, mesmo
-- padrão já usado em 20260821230000_expande_status_pedido_10_etapas.

-- AlterEnum
ALTER TYPE "StatusContaReceber" ADD VALUE 'PARCIAL' AFTER 'PENDENTE';
ALTER TYPE "StatusDespesa" ADD VALUE 'PARCIAL' AFTER 'PENDENTE';

-- CreateTable
CREATE TABLE "pagamentos_despesa" (
    "id" TEXT NOT NULL,
    "despesaId" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "forma" "FormaPagamento" NOT NULL,
    "formaDetalhe" TEXT,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagamentos_despesa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baixas_conta_receber" (
    "id" TEXT NOT NULL,
    "contaReceberId" TEXT NOT NULL,
    "pagamentoId" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "baixas_conta_receber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pagamentos_despesa_despesaId_idx" ON "pagamentos_despesa"("despesaId");

-- CreateIndex
CREATE INDEX "baixas_conta_receber_contaReceberId_idx" ON "baixas_conta_receber"("contaReceberId");

-- CreateIndex
CREATE INDEX "baixas_conta_receber_pagamentoId_idx" ON "baixas_conta_receber"("pagamentoId");

-- AddForeignKey
ALTER TABLE "pagamentos_despesa" ADD CONSTRAINT "pagamentos_despesa_despesaId_fkey" FOREIGN KEY ("despesaId") REFERENCES "despesas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baixas_conta_receber" ADD CONSTRAINT "baixas_conta_receber_contaReceberId_fkey" FOREIGN KEY ("contaReceberId") REFERENCES "contas_a_receber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baixas_conta_receber" ADD CONSTRAINT "baixas_conta_receber_pagamentoId_fkey" FOREIGN KEY ("pagamentoId") REFERENCES "pagamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
