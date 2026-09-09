-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A9 da Parte 4 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md, "Retenção de impostos na fonte") —
-- versão DECLARATIVA apenas. A proposta original ficou marcada 🔴 Caro
-- porque incluía o valor líquido esperado (após retenção) virar alvo de
-- CONCILIAÇÃO AUTOMÁTICA de pagamento — isso mudaria quando uma ContaReceber
-- é considerada "paga integralmente" (saldoContaReceber/
-- registrarBaixaContaReceber em src/lib/baixa-financeira.ts e
-- src/app/financeiro/contas-receber/actions.ts). ESSA PARTE FOI
-- DELIBERADAMENTE DEIXADA DE FORA: esta migration só adiciona cadastro +
-- registro/exibição, nenhuma linha de código de conciliação foi tocada.
--
-- Quando o tomador é PJ/órgão público, ele costuma reter parte do valor na
-- fonte (IRRF ~1,5%, CSRF/PIS+COFINS+CSLL ~4,65%, ISS retido 2-5% conforme
-- município — impressos personalizados são tributados por ISS, boa parte do
-- faturamento de gráfica é NFS-e onde a retenção acontece). Até aqui não
-- havia onde registrar isso: o valor recebido a menor (por causa da
-- retenção) parecia uma divergência sem explicação.
--
-- 1) Cliente.retemImpostos (BOOLEAN NOT NULL DEFAULT false) + tipoTomador
--    (enum fechado+OUTRO, nullable) + tipoTomadorOutro (nullable) — mesmo
--    padrão enum-fechado+OUTRO do resto do schema. @default(false)/null
--    preservam 100% o comportamento de hoje pra todo cliente já cadastrado.
--
-- 2) Tabela nova "retencoes_conta_receber" — uma linha por tributo retido
--    numa ContaReceber (pode ter mais de uma, ex: ISS + IRRF juntos).
--    Nenhuma ContaReceber tem nenhuma retenção até a gráfica cadastrar pela
--    nova tela na página da conta a receber — sem cadastro, nada muda.
--
-- 3) ContaReceber.valorRetencoes (DECIMAL(12,2) NOT NULL DEFAULT 0) — soma
--    das retenções, PURAMENTE INFORMATIVO. 100% aditivo: toda ContaReceber
--    existente e toda nova sem preencher este campo continua se comportando
--    EXATAMENTE como hoje (mesmo raciocínio de Pagamento.valorTaxa, achado
--    A11 da Parte 4, migration 20260908140000_taxa_forma_pagamento). NUNCA
--    calculado automaticamente, NUNCA lido por saldoContaReceber nem por
--    nenhum outro critério de "conta paga integralmente" — ver comentário
--    completo no schema (11-financeiro.prisma).

-- CreateEnum
CREATE TYPE "TipoTomador" AS ENUM ('PJ_PRIVADA', 'ORGAO_PUBLICO', 'PESSOA_FISICA', 'OUTRO');

-- CreateEnum
CREATE TYPE "TributoRetido" AS ENUM ('IRRF', 'CSRF', 'PIS', 'COFINS', 'CSLL', 'ISS', 'INSS', 'OUTRO');

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "retemImpostos" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tipoTomador" "TipoTomador",
ADD COLUMN     "tipoTomadorOutro" TEXT;

-- AlterTable
ALTER TABLE "contas_a_receber" ADD COLUMN     "valorRetencoes" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "retencoes_conta_receber" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "contaReceberId" TEXT NOT NULL,
    "tributo" "TributoRetido" NOT NULL,
    "tributoOutro" TEXT,
    "percentual" DECIMAL(5,2) NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retencoes_conta_receber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "retencoes_conta_receber_graficaId_idx" ON "retencoes_conta_receber"("graficaId");

-- CreateIndex
CREATE INDEX "retencoes_conta_receber_contaReceberId_idx" ON "retencoes_conta_receber"("contaReceberId");

-- AddForeignKey
ALTER TABLE "retencoes_conta_receber" ADD CONSTRAINT "retencoes_conta_receber_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retencoes_conta_receber" ADD CONSTRAINT "retencoes_conta_receber_contaReceberId_fkey" FOREIGN KEY ("contaReceberId") REFERENCES "contas_a_receber"("id") ON DELETE CASCADE ON UPDATE CASCADE;
