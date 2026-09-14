-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado F2 da auditoria de abrangência (2026-09-14) — Entrega era 1:1 com
-- Pedido ("entregas_pedidoId_key"). Passa a permitir N entregas por pedido
-- (remessa dividida, ou uma entrega com PROBLEMA seguida de uma nova do
-- zero) — a regra "nunca mais de uma em voo ao mesmo tempo" passa a viver
-- na Server Action (criarEntrega, src/app/producao/entrega-actions.ts), não
-- mais no banco.
--
-- Troca o índice ÚNICO por um índice normal (mesma coluna) — nenhuma linha
-- existente perde dado, nenhuma tabela nova. Toda gráfica com 0 ou 1
-- entrega por pedido hoje (o único estado possível até agora) continua
-- exatamente igual.

-- DropIndex
DROP INDEX "entregas_pedidoId_key";

-- CreateIndex
CREATE INDEX "entregas_pedidoId_idx" ON "entregas"("pedidoId");
