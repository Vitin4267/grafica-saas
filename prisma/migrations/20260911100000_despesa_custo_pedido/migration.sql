-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado Fin-A1 da Parte 4 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md): "Despesa" (contas a pagar) e
-- "CustoPedido" (custo real por pedido, alimenta lucroDoPedido em
-- src/lib/custo-pedido.ts) eram universos paralelos sem vínculo nenhum. Uma
-- terceirização de R$800 pra um pedido específico deveria virar as DUAS
-- coisas (Despesa E CustoPedido) — na prática só uma das duas era lançada, e
-- o lucro por pedido nunca fechava com o resultado do mês.
--
-- Precedente seguido (já maduro no schema, 3 ocorrências): "lançamento
-- espelhado com FK única pra nunca duplicar", sempre com a FK no lado
-- GERADO apontando pro lado ORIGEM — Comissao.despesaId,
-- MovimentacaoContaPrepaga.despesaId, CustoPedido.movimentacaoEstoqueId/
-- solicitacaoCompraId/etapaTerceirizadaId. A proposta original do achado
-- Fin-A1 sugeria "Despesa.custoPedidoId @unique", mas isso contraria o
-- precedente (FK sempre no GERADO) — corrigido aqui pra
-- "CustoPedido.despesaId @unique" (Despesa é a origem, CustoPedido é o
-- espelho gerado).
--
-- ESCOPO DELIBERADAMENTE REDUZIDO — só a direção Despesa → CustoPedido:
-- 1) "despesas"."pedidoId" — vínculo opcional "essa despesa é sobre ESTE
--    pedido" (aditivo, nullable, SetNull). Sozinho não gera nada.
-- 2) "custos_pedido"."despesaId" — FK única (aditivo, nullable, SetNull).
--    Populada só quando a despesa tem pedidoId E categoriaCustoId
--    preenchidos, pela mesma transação de criarDespesa/editarDespesa (ver
--    criarCustoAutomaticoDespesa em src/lib/custo-pedido.ts).
-- 3) Novo valor "DESPESA" em OrigemCusto. Nenhum valor antigo removido/
--    renomeado (mesmo cuidado de toda ADD VALUE anterior nesta sessão —
--    20260908140000_taxa_forma_pagamento, 20260909150000_regua_cobranca_
--    status_juros etc). Nenhum valor novo é usado em INSERT/UPDATE desta
--    própria migration, então não há problema de "ADD VALUE dentro da
--    transação que já usa o valor".
--
-- NÃO incluído nesta migration (fora de escopo por decisão explícita, ver
-- comentário em OrigemCusto.DESPESA no schema): o caminho INVERSO — gerar
-- uma Despesa a partir de um CustoPedido manual (ex: checkbox "essa despesa
-- ainda vai ser paga" no formulário de custo) — fica pra uma rodada futura,
-- depois que esta direção provar valor em uso real.
--
-- 100% aditivo: toda Despesa e todo CustoPedido já existentes continuam
-- com pedidoId/despesaId null, comportamento IDÊNTICO a hoje — regressão
-- zero pra qualquer gráfica que nunca usar este vínculo.

-- AlterEnum
ALTER TYPE "OrigemCusto" ADD VALUE 'DESPESA';

-- AlterTable
ALTER TABLE "despesas" ADD COLUMN "pedidoId" TEXT;

-- CreateIndex
CREATE INDEX "despesas_pedidoId_idx" ON "despesas"("pedidoId");

-- AddForeignKey
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "custos_pedido" ADD COLUMN "despesaId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "custos_pedido_despesaId_key" ON "custos_pedido"("despesaId");

-- AddForeignKey
ALTER TABLE "custos_pedido" ADD CONSTRAINT "custos_pedido_despesaId_fkey" FOREIGN KEY ("despesaId") REFERENCES "despesas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
