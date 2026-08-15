-- Fase "custo real": schema base (PR-0). Só plumbing — nenhuma mudança de
-- comportamento visível até os PRs seguintes lerem estas colunas/tabelas.
-- NOTA: o diff automático (prisma migrate diff) também sugeriu
-- `DROP TABLE "n8n_chatbot"` — tabela viva fora do escopo desta fase
-- (drift pré-existente, não gerenciada pelo Prisma). Removida desta
-- migration de propósito; não mexer nela aqui.

-- CreateEnum
CREATE TYPE "MetodoCusteio" AS ENUM ('PRECO_CADASTRO', 'ULTIMA_COMPRA', 'MEDIO_PONDERADO');

-- CreateEnum
CREATE TYPE "TipoDesconto" AS ENUM ('PERCENTUAL', 'VALOR_ABSOLUTO', 'PRECO_FINAL');

-- CreateEnum
CREATE TYPE "OrigemCusto" AS ENUM ('MANUAL', 'CONSUMO_ESTOQUE', 'COMISSAO', 'SERVICO_INSUMO');

-- CreateEnum
CREATE TYPE "OrigemPrevisao" AS ENUM ('MOTOR_PRECIFICACAO', 'FICHA_TECNICA', 'MANUAL');

-- AlterEnum
ALTER TYPE "ModuloPermissao" ADD VALUE 'CUSTOS';

-- AlterEnum
ALTER TYPE "UnidadeMedida" ADD VALUE 'MILHEIRO';

-- AlterEnum: TipoMovimentacao ganha 3 valores novos e renomeia os 2 antigos
-- (ENTRADA/SAIDA eram os únicos que existiam: SAIDA = baixa automática
-- Fila→Impressão, ENTRADA = estorno de cancelamento). USING faz o mapeamento
-- explícito valor-a-valor das linhas existentes — um cast cego por texto
-- quebraria, porque os literais antigos não existem no enum novo.
BEGIN;
CREATE TYPE "TipoMovimentacao_new" AS ENUM ('SAIDA_PRODUCAO', 'ESTORNO_CANCELAMENTO', 'ENTRADA_COMPRA', 'SAIDA_MANUAL', 'AJUSTE_INVENTARIO');
ALTER TABLE "movimentacoes_estoque" ALTER COLUMN "tipo" TYPE "TipoMovimentacao_new" USING (
  CASE ("tipo"::text)
    WHEN 'SAIDA' THEN 'SAIDA_PRODUCAO'
    WHEN 'ENTRADA' THEN 'ESTORNO_CANCELAMENTO'
  END::"TipoMovimentacao_new"
);
ALTER TYPE "TipoMovimentacao" RENAME TO "TipoMovimentacao_old";
ALTER TYPE "TipoMovimentacao_new" RENAME TO "TipoMovimentacao";
DROP TYPE "public"."TipoMovimentacao_old";
COMMIT;

-- AlterTable
ALTER TABLE "custos_pedido" ADD COLUMN     "criadoPorId" TEXT,
ADD COLUMN     "editadoManualmente" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "estornadoEm" TIMESTAMP(3),
ADD COLUMN     "movimentacaoEstoqueId" TEXT,
ADD COLUMN     "origem" "OrigemCusto" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "possivelDuplicidade" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "valorCalculado" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "itens_grafica" ADD COLUMN     "categoriaCustoId" TEXT,
ADD COLUMN     "fatorConversao" DECIMAL(12,4),
ADD COLUMN     "unidadeContagem" "UnidadeMedida";

-- AlterTable
ALTER TABLE "movimentacoes_estoque" ADD COLUMN     "criadoPorId" TEXT,
ADD COLUMN     "custoTotal" DECIMAL(12,2),
ADD COLUMN     "custoUnitario" DECIMAL(12,4),
ADD COLUMN     "documento" TEXT,
ADD COLUMN     "metodoCusteio" "MetodoCusteio" NOT NULL DEFAULT 'PRECO_CADASTRO',
ADD COLUMN     "precoReferenciaEm" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "orcamento_itens" ADD COLUMN     "aprovadoPorId" TEXT,
ADD COLUMN     "descontoTipo" "TipoDesconto",
ADD COLUMN     "descontoValor" DECIMAL(12,4),
ADD COLUMN     "motivoDesconto" VARCHAR(300),
ADD COLUMN     "precoSugeridoUnitario" DECIMAL(12,4);

-- AlterTable
ALTER TABLE "parametros_grafica" ADD COLUMN     "categoriaCustoConsumoPadraoId" TEXT,
ADD COLUMN     "comissaoEntraNoCustoPedido" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "custoAutomaticoConsumo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "descontoMaxSemAprovacao" DECIMAL(5,2) NOT NULL DEFAULT 100,
ADD COLUMN     "diasPrecoInsumoDesatualizado" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "margemFaixaBaixa" DECIMAL(5,2) NOT NULL DEFAULT 10,
ADD COLUMN     "margemFaixaBoa" DECIMAL(5,2) NOT NULL DEFAULT 25,
ADD COLUMN     "perdaEhCustoDoPedido" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "pedidos" ADD COLUMN     "aprovadoEm" TIMESTAMP(3),
ADD COLUMN     "custoPrevistoTotal" DECIMAL(12,2),
ADD COLUMN     "fechadoEm" TIMESTAMP(3),
ADD COLUMN     "fechadoPorId" TEXT,
ADD COLUMN     "precoSugeridoTotal" DECIMAL(12,2),
ADD COLUMN     "valorNegociadoTotal" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "pedido_custo_previsto" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "categoriaCustoId" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "origem" "OrigemPrevisao" NOT NULL,
    "detalhe" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pedido_custo_previsto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pedido_custo_previsto_graficaId_pedidoId_idx" ON "pedido_custo_previsto"("graficaId", "pedidoId");

-- CreateIndex
CREATE INDEX "pedido_custo_previsto_categoriaCustoId_idx" ON "pedido_custo_previsto"("categoriaCustoId");

-- CreateIndex
CREATE UNIQUE INDEX "custos_pedido_movimentacaoEstoqueId_key" ON "custos_pedido"("movimentacaoEstoqueId");

-- CreateIndex
CREATE INDEX "itens_grafica_categoriaCustoId_idx" ON "itens_grafica"("categoriaCustoId");

-- AddForeignKey
ALTER TABLE "itens_grafica" ADD CONSTRAINT "itens_grafica_categoriaCustoId_fkey" FOREIGN KEY ("categoriaCustoId") REFERENCES "categorias_custo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custos_pedido" ADD CONSTRAINT "custos_pedido_movimentacaoEstoqueId_fkey" FOREIGN KEY ("movimentacaoEstoqueId") REFERENCES "movimentacoes_estoque"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_custo_previsto" ADD CONSTRAINT "pedido_custo_previsto_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_custo_previsto" ADD CONSTRAINT "pedido_custo_previsto_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_custo_previsto" ADD CONSTRAINT "pedido_custo_previsto_categoriaCustoId_fkey" FOREIGN KEY ("categoriaCustoId") REFERENCES "categorias_custo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
