-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado F5 da auditoria de abrangência (pesquisa-abrangencia-modulos.md,
-- Parte 7, "Arte é uma só por orçamento/pedido; não existe arte por item"):
--
-- Orcamento.arteUrl/Pedido.arteUrl continuam existindo, sem nenhuma mudança
-- — são o cabeçalho, LEGADO pra sempre. Esta migração só ADICIONA a
-- possibilidade de anexar/aprovar arte POR OrcamentoItem, feature opt-in por
-- USO: uma gráfica que nunca criar nenhuma linha em "arte_itens" continua
-- 100% no fluxo de cabeçalho de sempre.
--
-- Adiciona:
-- - valor 'ARTE_ITEM' no enum "TipoArquivoArmazenado" (ADD VALUE, aditivo —
--   nenhum arquivo já existente muda de tipo).
-- - tabela "arte_itens": 1 linha por OrcamentoItem que já recebeu arte
--   (unique orcamentoItemId, mesmo padrão 1:1-com-substituição de
--   "orcamento_item_tinta"), com FK opcional pra "pedidos" (pedidoId),
--   resolvida em código no momento do upload — nunca escolhida pelo
--   usuário. Ver comentário completo no model ArteItem
--   (prisma/schema/09-orcamento.prisma).
--
-- Migração 100% aditiva: nenhuma tabela/coluna/enum existente muda de
-- tipo/obrigatoriedade, nenhum dado é reescrito.

-- AlterEnum
ALTER TYPE "TipoArquivoArmazenado" ADD VALUE 'ARTE_ITEM';

-- CreateTable
CREATE TABLE "arte_itens" (
    "id" TEXT NOT NULL,
    "orcamentoItemId" TEXT NOT NULL,
    "pedidoId" TEXT,
    "url" TEXT NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "aprovadaEm" TIMESTAMP(3),
    "comentarioCliente" TEXT,
    "respondidaPor" TEXT,
    "preflightAvisos" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arte_itens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "arte_itens_orcamentoItemId_key" ON "arte_itens"("orcamentoItemId");

-- CreateIndex
CREATE INDEX "arte_itens_pedidoId_idx" ON "arte_itens"("pedidoId");

-- AddForeignKey
ALTER TABLE "arte_itens" ADD CONSTRAINT "arte_itens_orcamentoItemId_fkey" FOREIGN KEY ("orcamentoItemId") REFERENCES "orcamento_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arte_itens" ADD CONSTRAINT "arte_itens_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
