-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado B5 da auditoria de abrangência (Parte 1,
-- pesquisa-abrangencia-modulos.md): "Não há tabela de faixas de quantidade
-- no mesmo item" — o orçamento gráfico brasileiro clássico apresenta 3
-- tiragens lado a lado ("1.000 / 3.000 / 5.000 unidades — R$X / R$Y / R$Z").
-- OrcamentoOpcao (já existia) chega perto mas varia o CONJUNTO INTEIRO de
-- itens de uma proposta, não a quantidade de UM item. Esta migração cria uma
-- tabela PARALELA (não mexe em nenhuma tabela/coluna existente): cada linha
-- é uma tiragem alternativa de UM OrcamentoItem, recalculada pelo mesmo
-- motor de precificação (ver src/lib/orcamento-precificacao.ts).
--
-- Migração 100% aditiva: nenhuma tabela/coluna existente muda de
-- tipo/obrigatoriedade, nenhum dado é reescrito. Toda gráfica/orçamento
-- existente fica sem nenhuma linha nesta tabela nova até que alguém adicione
-- uma faixa pela tela em /orcamento/[id] (ver
-- src/app/orcamento/[id]/actions/faixas.ts).

-- CreateTable
CREATE TABLE "orcamento_item_faixas_quantidade" (
    "id" TEXT NOT NULL,
    "orcamentoItemId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "precoUnitario" DECIMAL(12,2) NOT NULL,
    "precoTotal" DECIMAL(12,2) NOT NULL,
    "breakdown" JSONB,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orcamento_item_faixas_quantidade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orcamento_item_faixas_quantidade_orcamentoItemId_idx" ON "orcamento_item_faixas_quantidade"("orcamentoItemId");

-- AddForeignKey
ALTER TABLE "orcamento_item_faixas_quantidade" ADD CONSTRAINT "orcamento_item_faixas_quantidade_orcamentoItemId_fkey" FOREIGN KEY ("orcamentoItemId") REFERENCES "orcamento_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
