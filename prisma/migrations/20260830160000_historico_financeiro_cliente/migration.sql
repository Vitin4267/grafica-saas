-- Achado A10 da Parte 5 da auditoria de abrangência (2026-08-30): não havia
-- visão financeira nem histórico no cadastro do cliente, e a consulta "por
-- cliente" nem índice tinha.
--
-- 1) Índice [graficaId, clienteId] em "orcamentos" — toda consulta "orçamentos
--    deste cliente" (ficha do cliente, relatorios-negocio.ts) filtrava sem
--    índice dedicado.
-- 2) "contas_a_receber"."clienteId" (FK opcional pra "clientes", SET NULL) —
--    antes só dava pra chegar no cliente via ContaReceber -> Orcamento ->
--    clienteId. Preenchida na criação a partir de Orcamento.clienteId (ver
--    gerarContasReceberDaAprovacao em src/lib/condicao-pagamento.ts e
--    criarContaReceber em src/app/financeiro/contas-receber/actions.ts).
--    Backfill abaixo preenche o histórico já existente via join com
--    "orcamentos" — barato (uma tabela pequena) e evita todo o histórico
--    anterior a esta migração nascer com clienteId nulo à toa.
--
-- Tudo aditivo: coluna nova é nullable, índices novos não mudam nenhuma query
-- existente.

-- AlterTable
ALTER TABLE "contas_a_receber" ADD COLUMN "clienteId" TEXT;

-- Backfill do histórico existente a partir do orçamento já vinculado.
UPDATE "contas_a_receber" cr
SET "clienteId" = o."clienteId"
FROM "orcamentos" o
WHERE cr."orcamentoId" = o.id
  AND cr."clienteId" IS NULL;

-- CreateIndex
CREATE INDEX "contas_a_receber_clienteId_idx" ON "contas_a_receber"("clienteId");

-- CreateIndex
CREATE INDEX "orcamentos_graficaId_clienteId_idx" ON "orcamentos"("graficaId", "clienteId");

-- AddForeignKey
ALTER TABLE "contas_a_receber" ADD CONSTRAINT "contas_a_receber_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
