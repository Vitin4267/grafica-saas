-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado E1 da auditoria de abrangência (Parte 2/Produção,
-- pesquisa-abrangencia-modulos.md, 2026-09-01): nada no schema modelava um
-- pedido que sai FISICAMENTE da gráfica pra uma operação terceirizada
-- (laminação, UV, acabamento de livro etc.) e volta depois — o card ficava
-- parado numa etapa (geralmente ACABAMENTO) por dias sem ninguém saber se é
-- lentidão interna ou se está no terceiro, e o custo do terceiro só entrava
-- como CustoPedido origem=MANUAL, sem prazo, sem fornecedor vinculado, sem
-- alerta.
--
-- Adiciona:
-- - enum "SituacaoTerceirizacao": AGUARDANDO_ENVIO / ENVIADO / RETORNADO /
--   PROBLEMA.
-- - tabela "etapas_terceirizadas": um registro por terceirização de etapa de
--   um Pedido, com fornecedor (estruturado OU nome livre), datas de
--   envio/previsão/retorno, valores acordado/final, nº de nota de remessa/
--   retorno (CFOP 5901/6901 remessa, 5902/6902 retorno) e dedup de alerta de
--   atraso próprio (alertaAtrasoEnviadoEm).
-- - valor novo no enum "OrigemCusto": 'TERCEIRIZACAO' — gerado
--   automaticamente quando EtapaTerceirizada.valorFinal é preenchido (ver
--   criarCustoAutomaticoTerceirizacao em src/lib/custo-pedido.ts).
-- - coluna "etapaTerceirizadaId" em "custos_pedido" (dedup 1:1, mesmo padrão
--   de "solicitacaoCompraId").
--
-- ADD VALUE em enum não pode ser usado (INSERT/UPDATE/comparação) na MESMA
-- transação em que foi adicionado — mas este arquivo só CRIA colunas/tipos,
-- nunca escreve uma linha usando 'TERCEIRIZACAO', então roda sem problema no
-- mesmo migration.sql (mesmo padrão já usado em
-- 20260829100000_origem_solicitacao_compra/migration.sql e
-- 20260821224801_gang_run_fila/migration.sql).
--
-- Migração 100% aditiva: nenhuma tabela/coluna existente muda de
-- tipo/obrigatoriedade, nenhum dado é reescrito.

-- CreateEnum
CREATE TYPE "SituacaoTerceirizacao" AS ENUM ('AGUARDANDO_ENVIO', 'ENVIADO', 'RETORNADO', 'PROBLEMA');

-- AlterEnum
ALTER TYPE "OrigemCusto" ADD VALUE 'TERCEIRIZACAO';

-- CreateTable
CREATE TABLE "etapas_terceirizadas" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "status" "StatusPedido" NOT NULL,
    "fornecedorId" TEXT,
    "fornecedorNome" TEXT,
    "situacao" "SituacaoTerceirizacao" NOT NULL DEFAULT 'AGUARDANDO_ENVIO',
    "enviadoEm" TIMESTAMP(3),
    "previsaoRetorno" TIMESTAMP(3),
    "retornadoEm" TIMESTAMP(3),
    "valorAcordado" DECIMAL(10,2),
    "valorFinal" DECIMAL(10,2),
    "notaRemessa" TEXT,
    "notaRetorno" TEXT,
    "observacao" TEXT,
    "alertaAtrasoEnviadoEm" TIMESTAMP(3),
    "criadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etapas_terceirizadas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "etapas_terceirizadas_graficaId_idx" ON "etapas_terceirizadas"("graficaId");

-- CreateIndex
CREATE INDEX "etapas_terceirizadas_pedidoId_idx" ON "etapas_terceirizadas"("pedidoId");

-- CreateIndex
CREATE INDEX "etapas_terceirizadas_fornecedorId_idx" ON "etapas_terceirizadas"("fornecedorId");

-- AddForeignKey
ALTER TABLE "etapas_terceirizadas" ADD CONSTRAINT "etapas_terceirizadas_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etapas_terceirizadas" ADD CONSTRAINT "etapas_terceirizadas_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etapas_terceirizadas" ADD CONSTRAINT "etapas_terceirizadas_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "fornecedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "custos_pedido" ADD COLUMN "etapaTerceirizadaId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "custos_pedido_etapaTerceirizadaId_key" ON "custos_pedido"("etapaTerceirizadaId");

-- AddForeignKey
ALTER TABLE "custos_pedido" ADD CONSTRAINT "custos_pedido_etapaTerceirizadaId_fkey" FOREIGN KEY ("etapaTerceirizadaId") REFERENCES "etapas_terceirizadas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
