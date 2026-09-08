-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A11 da Parte 4 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md, "Custo financeiro de receber (maquininha,
-- antecipação)"): a taxa REAL cobrada pela maquininha/banco num pagamento
-- (MDR, antecipação) não era registrada em lugar nenhum — só existia
-- ParametrosGrafica.taxaFinanceiraPercent, que é ESTIMATIVA usada no motor
-- de preço do orçamento, nunca o valor real do recebimento. FormaPagamento
-- também não carregava prazo de compensação (PIX cai na hora, cartão pode
-- levar 30 dias) nem distinguia cartão de crédito/débito ou cheque.
--
-- 1) Pagamento.valorTaxa — coluna nova, DECIMAL(12,2) NOT NULL DEFAULT 0.
--    100% aditivo: todo Pagamento já existente e todo Pagamento novo que não
--    preencher o campo continua com valorTaxa=0, comportamento IDÊNTICO a
--    hoje (a taxa continua invisível no resultado financeiro até alguém
--    preencher esse campo manualmente). NUNCA calculado retroativamente
--    sobre um pagamento já existente.
--
-- 2) 3 novos valores de FormaPagamento (CARTAO_CREDITO, CARTAO_DEBITO,
--    CHEQUE) — ADD VALUE aditivo, nenhum valor antigo removido/renomeado.
--    CARTAO continua existindo pra todo Pagamento/PagamentoDespesa/Despesa
--    histórico que já usa ele; só as telas NOVAS de registro passam a
--    oferecer os valores específicos. Nenhum valor novo é usado em
--    INSERT/UPDATE desta própria migration, então não há problema de "ADD
--    VALUE dentro da transação que já usa o valor" (mesmo cuidado documentado
--    em 20260907120000_compras_recebimento_parcial).
--
-- 3) Tabela nova "taxas_forma_pagamento" — cadastro simples por gráfica
--    (forma + percentual + dias de compensação), único por (graficaId,
--    forma). Nenhuma gráfica tem nenhuma cadastrada até criar uma pela nova
--    tela em /configuracoes/taxas-forma-pagamento — sem cadastro, o
--    pré-preenchimento de valorTaxa simplesmente não aparece, tudo
--    continua manual como hoje.

-- AlterEnum
ALTER TYPE "FormaPagamento" ADD VALUE 'CARTAO_CREDITO';
ALTER TYPE "FormaPagamento" ADD VALUE 'CARTAO_DEBITO';
ALTER TYPE "FormaPagamento" ADD VALUE 'CHEQUE';

-- AlterTable
ALTER TABLE "pagamentos" ADD COLUMN "valorTaxa" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "taxas_forma_pagamento" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "forma" "FormaPagamento" NOT NULL,
    "percentual" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "diasCompensacao" INTEGER NOT NULL DEFAULT 0,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "taxas_forma_pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "taxas_forma_pagamento_graficaId_idx" ON "taxas_forma_pagamento"("graficaId");

-- CreateIndex
CREATE UNIQUE INDEX "taxas_forma_pagamento_graficaId_forma_key" ON "taxas_forma_pagamento"("graficaId", "forma");

-- AddForeignKey
ALTER TABLE "taxas_forma_pagamento" ADD CONSTRAINT "taxas_forma_pagamento_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
