-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A15 da Parte 4 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md): cadastro de "conta financeira" (conta
-- bancária, caixa físico, poupança, carteira digital) + vínculo OPCIONAL em
-- Pagamento/Despesa (ONDE o dinheiro está, complementar a FormaPagamento,
-- que já diz COMO) + Despesa.filialId (par do lado da despesa de
-- Orcamento.filialId, que já existia do lado da receita).
--
-- 100% aditivo, nenhuma coluna/tabela existente muda de nome/tipo/
-- obrigatoriedade: tabela nova "contas_financeiras" + 3 colunas nullable
-- ("pagamentos"."contaFinanceiraId", "despesas"."contaFinanceiraId",
-- "despesas"."filialId"). Nenhuma gráfica tem nenhuma ContaFinanceira
-- cadastrada até criar uma pela nova tela em
-- /configuracoes/contas-financeiras, e todo Pagamento/Despesa já existente
-- fica com contaFinanceiraId NULL (comportamento de hoje 100% preservado).
--
-- Escopo desta rodada é só cadastro + vínculo informativo — NENHUM saldo por
-- conta é calculado/armazenado (ver comentário no model ContaFinanceira no
-- schema).

-- CreateEnum
CREATE TYPE "TipoContaFinanceira" AS ENUM ('CONTA_CORRENTE', 'CAIXA', 'POUPANCA', 'CARTEIRA_DIGITAL', 'OUTRO');

-- CreateTable
CREATE TABLE "contas_financeiras" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoContaFinanceira" NOT NULL,
    "saldoInicial" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "saldoInicialEm" DATE,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contas_financeiras_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "pagamentos" ADD COLUMN     "contaFinanceiraId" TEXT;

-- AlterTable
ALTER TABLE "despesas" ADD COLUMN     "contaFinanceiraId" TEXT,
ADD COLUMN     "filialId" TEXT;

-- CreateIndex
CREATE INDEX "contas_financeiras_graficaId_idx" ON "contas_financeiras"("graficaId");

-- CreateIndex
CREATE UNIQUE INDEX "contas_financeiras_graficaId_nome_key" ON "contas_financeiras"("graficaId", "nome");

-- CreateIndex
CREATE INDEX "pagamentos_contaFinanceiraId_idx" ON "pagamentos"("contaFinanceiraId");

-- CreateIndex
CREATE INDEX "despesas_contaFinanceiraId_idx" ON "despesas"("contaFinanceiraId");

-- CreateIndex
CREATE INDEX "despesas_filialId_idx" ON "despesas"("filialId");

-- AddForeignKey
ALTER TABLE "contas_financeiras" ADD CONSTRAINT "contas_financeiras_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_contaFinanceiraId_fkey" FOREIGN KEY ("contaFinanceiraId") REFERENCES "contas_financeiras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_contaFinanceiraId_fkey" FOREIGN KEY ("contaFinanceiraId") REFERENCES "contas_financeiras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_filialId_fkey" FOREIGN KEY ("filialId") REFERENCES "filiais"("id") ON DELETE SET NULL ON UPDATE CASCADE;
