-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A7 da Parte 4 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md): condições de pagamento eram texto
-- livre (orcamentos.condicoesPagamento, mantido) e parcelas de contas a
-- receber eram 100% cadastradas à mão. Adiciona um registro ESTRUTURADO de
-- condição de pagamento (com parcelas e âncora de vencimento), pra gerar
-- ContaReceber automaticamente na aprovação do orçamento.
--
-- Adiciona:
-- - enum AncoraVencimento.
-- - tabela condicoes_pagamento (1 gráfica -> N condições, soft-delete via
--   `ativa`, nunca hard delete) + condicao_pagamento_parcelas (1 condição
--   -> N parcelas).
-- - orcamentos.condicaoPagamentoId: FK opcional que CONVIVE com o texto
--   livre já existente orcamentos.condicoesPagamento (não é alterado ou
--   removido aqui).
--
-- Migração 100% aditiva: nenhuma coluna existente muda de tipo/obrigatoriedade,
-- nenhum dado é reescrito. Orçamento sem condicaoPagamentoId (o caso de
-- sempre, até alguém vincular uma condição) continua se comportando
-- exatamente como hoje — nenhuma ContaReceber é gerada automaticamente.

-- CreateEnum
CREATE TYPE "AncoraVencimento" AS ENUM ('APROVACAO', 'EMISSAO_NOTA', 'ENTREGA', 'OUTRO');

-- CreateTable
CREATE TABLE "condicoes_pagamento" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ancora" "AncoraVencimento" NOT NULL DEFAULT 'APROVACAO',
    "acrescimoPercent" DECIMAL(5,2),
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "condicoes_pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "condicao_pagamento_parcelas" (
    "id" TEXT NOT NULL,
    "condicaoPagamentoId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "percentual" DECIMAL(5,2) NOT NULL,
    "diasAposAncora" INTEGER NOT NULL,

    CONSTRAINT "condicao_pagamento_parcelas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "condicoes_pagamento_graficaId_nome_key" ON "condicoes_pagamento"("graficaId", "nome");

-- CreateIndex
CREATE INDEX "condicoes_pagamento_graficaId_ativa_idx" ON "condicoes_pagamento"("graficaId", "ativa");

-- CreateIndex
CREATE INDEX "condicao_pagamento_parcelas_condicaoPagamentoId_idx" ON "condicao_pagamento_parcelas"("condicaoPagamentoId");

-- AddForeignKey
ALTER TABLE "condicoes_pagamento" ADD CONSTRAINT "condicoes_pagamento_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "condicao_pagamento_parcelas" ADD CONSTRAINT "condicao_pagamento_parcelas_condicaoPagamentoId_fkey" FOREIGN KEY ("condicaoPagamentoId") REFERENCES "condicoes_pagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "orcamentos" ADD COLUMN     "condicaoPagamentoId" TEXT;

-- CreateIndex
CREATE INDEX "orcamentos_condicaoPagamentoId_idx" ON "orcamentos"("condicaoPagamentoId");

-- AddForeignKey
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_condicaoPagamentoId_fkey" FOREIGN KEY ("condicaoPagamentoId") REFERENCES "condicoes_pagamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;
