-- Achado A3 da auditoria de abrangência (Parte 3/Compras, 2026-08-29):
-- SolicitacaoCompra não distinguia reposição de estoque (make-to-stock) de
-- compra feita especificamente pra um Pedido de produção (make-to-order), e
-- o custo dessa compra nunca chegava ao pedido quando o item comprado não
-- está na ficha técnica (clichê, faca, terceirização).
--
-- ADD VALUE em enum não pode ser usado (INSERT/UPDATE/comparação) na MESMA
-- transação em que foi adicionado — mas este arquivo só CRIA colunas/tipos,
-- nunca escreve uma linha usando 'COMPRA', então roda sem problema no mesmo
-- migration.sql (mesmo padrão já usado em
-- 20260821224801_gang_run_fila/migration.sql, que também combina ADD VALUE
-- com CREATE TABLE no mesmo arquivo).

-- CreateEnum
CREATE TYPE "OrigemSolicitacaoCompra" AS ENUM ('REPOSICAO_ESTOQUE', 'PEDIDO_ESPECIFICO', 'MANUTENCAO', 'CONSUMO_INTERNO', 'CONTRATO_PROGRAMADO', 'OUTRO');

-- AlterEnum
ALTER TYPE "OrigemCusto" ADD VALUE 'COMPRA';

-- AlterTable
ALTER TABLE "solicitacoes_compra" ADD COLUMN "origem" "OrigemSolicitacaoCompra" NOT NULL DEFAULT 'REPOSICAO_ESTOQUE',
ADD COLUMN "origemOutro" TEXT,
ADD COLUMN "pedidoId" TEXT;

-- AlterTable
ALTER TABLE "custos_pedido" ADD COLUMN "solicitacaoCompraId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "custos_pedido_solicitacaoCompraId_key" ON "custos_pedido"("solicitacaoCompraId");

-- CreateIndex
CREATE INDEX "solicitacoes_compra_pedidoId_idx" ON "solicitacoes_compra"("pedidoId");

-- AddForeignKey
ALTER TABLE "solicitacoes_compra" ADD CONSTRAINT "solicitacoes_compra_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custos_pedido" ADD CONSTRAINT "custos_pedido_solicitacaoCompraId_fkey" FOREIGN KEY ("solicitacaoCompraId") REFERENCES "solicitacoes_compra"("id") ON DELETE SET NULL ON UPDATE CASCADE;
