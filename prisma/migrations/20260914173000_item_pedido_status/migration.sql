-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado F3 da auditoria de abrangência (2026-09-14), escopo reduzido —
-- "produção monolítica por pedido, não por item". Em vez de reformar
-- Pedido.status (a FSM inteira, com CAS em status-transicao.ts) pra virar
-- por-item, adiciona um marcador de progresso ADITIVO e PARALELO, mesmo
-- espírito de ParadaPedido (migration 20260904130000_parada_pedido): nunca
-- muda Pedido.status, só ajuda o dono a ver "faltam 2 dos 5 itens" num
-- pedido grande.
--
-- Adiciona:
-- - tabela "item_pedido_status": 1 linha por item MARCADO como concluído
--   dentro de um pedido (ausência de linha = ainda não concluído — não
--   existe coluna boolean, a linha só existe quando marcada).
-- - índice único (pedidoId, orcamentoItemId): no máximo 1 marcação por item
--   dentro do mesmo pedido.
--
-- Migração 100% aditiva: nenhuma tabela/coluna existente muda de
-- tipo/obrigatoriedade, nenhum dado é reescrito.

-- CreateTable
CREATE TABLE "item_pedido_status" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "orcamentoItemId" TEXT NOT NULL,
    "concluidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoPorId" TEXT,

    CONSTRAINT "item_pedido_status_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "item_pedido_status_pedidoId_orcamentoItemId_key" ON "item_pedido_status"("pedidoId", "orcamentoItemId");

-- CreateIndex
CREATE INDEX "item_pedido_status_graficaId_idx" ON "item_pedido_status"("graficaId");

-- CreateIndex
CREATE INDEX "item_pedido_status_orcamentoItemId_idx" ON "item_pedido_status"("orcamentoItemId");

-- AddForeignKey
ALTER TABLE "item_pedido_status" ADD CONSTRAINT "item_pedido_status_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_pedido_status" ADD CONSTRAINT "item_pedido_status_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_pedido_status" ADD CONSTRAINT "item_pedido_status_orcamentoItemId_fkey" FOREIGN KEY ("orcamentoItemId") REFERENCES "orcamento_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_pedido_status" ADD CONSTRAINT "item_pedido_status_concluidoPorId_fkey" FOREIGN KEY ("concluidoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
