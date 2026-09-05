-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado C2 da auditoria de abrangência (Parte 2/Produção,
-- pesquisa-abrangencia-modulos.md, 2026-09-01): um job travado esperando
-- papel chegar, ou esperando o cliente responder uma dúvida, era
-- indistinguível de um job sendo produzido de verdade — ambos apareciam
-- simplesmente como o StatusPedido atual. RegistroManutencao cobre "a
-- MÁQUINA parou", nunca "o PEDIDO parou".
--
-- Adiciona:
-- - enum "MotivoParada": AGUARDANDO_MATERIAL / AGUARDANDO_APROVACAO_CLIENTE /
--   AGUARDANDO_ARTE_CLIENTE / MAQUINA_PARADA / AGUARDANDO_TERCEIRO /
--   FALTA_OPERADOR / OUTRO.
-- - tabela "paradas_pedido": um registro por intervalo em que um Pedido
--   ficou parado, com motivo, vínculo opcional com o ApontamentoEtapa aberto
--   no momento e com a SolicitacaoCompra que o pedido está esperando (quando
--   o motivo é falta de material).
-- - índice único PARCIAL garantindo, no nível do banco, "no máximo 1 parada
--   ATIVA (finalizadaEm IS NULL) por pedido" — Prisma declarativo não tem
--   sintaxe pra WHERE em @@unique/@@index, por isso este índice só existe
--   aqui (não tem representação no prisma/schema/10-producao.prisma, ver
--   comentário no model ParadaPedido). Qualquer migration futura escrita à
--   mão que mexer nesta tabela precisa preservá-lo.
--
-- Migração 100% aditiva: nenhuma tabela/coluna existente muda de
-- tipo/obrigatoriedade, nenhum dado é reescrito.

-- CreateEnum
CREATE TYPE "MotivoParada" AS ENUM ('AGUARDANDO_MATERIAL', 'AGUARDANDO_APROVACAO_CLIENTE', 'AGUARDANDO_ARTE_CLIENTE', 'MAQUINA_PARADA', 'AGUARDANDO_TERCEIRO', 'FALTA_OPERADOR', 'OUTRO');

-- CreateTable
CREATE TABLE "paradas_pedido" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "apontamentoEtapaId" TEXT,
    "motivo" "MotivoParada" NOT NULL,
    "motivoOutro" TEXT,
    "solicitacaoCompraId" TEXT,
    "iniciadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizadaEm" TIMESTAMP(3),
    "observacao" TEXT,
    "criadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paradas_pedido_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "paradas_pedido_graficaId_idx" ON "paradas_pedido"("graficaId");

-- CreateIndex
CREATE INDEX "paradas_pedido_pedidoId_idx" ON "paradas_pedido"("pedidoId");

-- CreateIndex
CREATE INDEX "paradas_pedido_apontamentoEtapaId_idx" ON "paradas_pedido"("apontamentoEtapaId");

-- CreateIndex
CREATE INDEX "paradas_pedido_solicitacaoCompraId_idx" ON "paradas_pedido"("solicitacaoCompraId");

-- CreateIndex
CREATE INDEX "paradas_pedido_pedidoId_finalizadaEm_idx" ON "paradas_pedido"("pedidoId", "finalizadaEm");

-- CreateIndex (PARCIAL — garante "no máximo 1 parada ativa por pedido" no
-- banco; não representável no prisma/schema declarativo, ver comentário no
-- topo deste arquivo e no model ParadaPedido).
CREATE UNIQUE INDEX "paradas_pedido_pedido_ativa_key" ON "paradas_pedido"("pedidoId") WHERE "finalizadaEm" IS NULL;

-- AddForeignKey
ALTER TABLE "paradas_pedido" ADD CONSTRAINT "paradas_pedido_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paradas_pedido" ADD CONSTRAINT "paradas_pedido_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paradas_pedido" ADD CONSTRAINT "paradas_pedido_apontamentoEtapaId_fkey" FOREIGN KEY ("apontamentoEtapaId") REFERENCES "apontamentos_etapa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paradas_pedido" ADD CONSTRAINT "paradas_pedido_solicitacaoCompraId_fkey" FOREIGN KEY ("solicitacaoCompraId") REFERENCES "solicitacoes_compra"("id") ON DELETE SET NULL ON UPDATE CASCADE;
