-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A7 da Parte 3 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md, "Compras"): recebimento parcial e
-- divergência entre o pedido de compra e o que de fato chegou.
--
-- 1) Novo valor de enum RECEBIDO_PARCIAL, inserido ANTES de RECEBIDO (ordem
--    igual à declarada no schema) — ver StatusSolicitacaoCompra em
--    prisma/schema/08-compras.prisma. Não é usado em nenhum UPDATE/INSERT
--    desta mesma migration, então não há problema de "ADD VALUE dentro da
--    transação que já usa o valor" (restrição do Postgres pra enum
--    pré-existente).
--
-- 2) 3 colunas novas em "solicitacoes_compra", todas opcionais — 100%
--    aditivo, nenhuma linha existente é reescrita. quantidadeRecebida fica
--    NULL pra toda solicitação já existente (nunca 0 — "ainda não apurado",
--    mesmo princípio de MovimentacaoEstoque.custoUnitario).
--
-- 3) "movimentacoes_estoque"."solicitacaoCompraId" deixa de ser @unique:
--    recebimento parcial pode gerar mais de uma MovimentacaoEstoque pra
--    mesma solicitação (uma por confirmação de RECEBIDO/RECEBIDO_PARCIAL).
--    Confirmado antes desta migration que não havia nenhuma duplicata em
--    produção (não deveria haver, já que era @unique até aqui) — troca o
--    índice único por um índice normal, não reescreve nenhuma linha.

-- AlterEnum
ALTER TYPE "StatusSolicitacaoCompra" ADD VALUE 'RECEBIDO_PARCIAL' BEFORE 'RECEBIDO';

-- AlterTable
ALTER TABLE "solicitacoes_compra"
  ADD COLUMN "quantidadeRecebida" DECIMAL(12,4),
  ADD COLUMN "valorNotaFiscal" DECIMAL(12,2),
  ADD COLUMN "divergenciaObservacao" TEXT;

-- AlterTable (movimentacoes_estoque.solicitacaoCompraId: @unique -> índice normal)
DROP INDEX "movimentacoes_estoque_solicitacaoCompraId_key";
CREATE INDEX "movimentacoes_estoque_solicitacaoCompraId_idx" ON "movimentacoes_estoque"("solicitacaoCompraId");
