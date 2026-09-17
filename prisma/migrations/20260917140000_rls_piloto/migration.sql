-- Fase B do isolamento multi-tenant (RLS real no Postgres) — achado da
-- auditoria de segurança 2026-09-17. Ver o plano completo em
-- ~/.claude/plans/deep-zooming-parasol.md pro contexto e o porquê de cada
-- decisão abaixo. Piloto: 5 tabelas (clientes, contas_a_receber,
-- dados_fiscais_grafica, pedidos, entregas) — as demais tabelas
-- multi-tenant ficam de fora nesta rodada, ver "Expansão futura" no plano.
--
-- Pré-condição já cumprida antes desta migration: o app roda com o role
-- `grafica_app` (criado nesta mesma auditoria), que NÃO é dono das
-- tabelas — só por isso ENABLE ROW LEVEL SECURITY já tem efeito nele.
-- Migração roda como `neondb_owner` (via MIGRATION_DATABASE_URL), que
-- CONTINUA vendo tudo sem restrição — por isso NÃO usamos
-- FORCE ROW LEVEL SECURITY (diferente do exemplo oficial da Prisma, que
-- usa o mesmo usuário pra migração e app): FORCE aplicaria a policy até
-- pro dono, o que quebraria toda ferramenta administrativa que roda com
-- MIGRATION_DATABASE_URL.
--
-- Duas policies permissivas por tabela (Postgres combina com OR):
-- 1) tenant_isolation — a query só enxerga linha cujo "graficaId" bate
--    com o runtime parameter setado pelo app (src/lib/prisma.ts,
--    construirSetConfigRaw) antes de cada operação.
-- 2) bypass_rls — cobre os usos legítimos de semTenant() (cron de
--    backup/lifecycle, resolução de token público antes de saber a
--    gráfica) — só ativa quando o app seta app.bypass_rls = 'on'
--    explicitamente.
-- current_setting(..., TRUE) — o TRUE é "missing_ok": se o app esquecer
-- de setar (bug futuro em código que ainda não passou por este
-- mecanismo), current_setting devolve NULL em vez de lançar erro, e
-- "graficaId" = NULL nunca é verdadeiro em SQL — fail-closed automático
-- (zero linhas, nunca vaza), não fail-crash.

ALTER TABLE "clientes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "clientes"
  USING ("graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "clientes"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');

ALTER TABLE "contas_a_receber" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contas_a_receber"
  USING ("graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "contas_a_receber"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');

ALTER TABLE "dados_fiscais_grafica" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "dados_fiscais_grafica"
  USING ("graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "dados_fiscais_grafica"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');

ALTER TABLE "pedidos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pedidos"
  USING ("graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "pedidos"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');

ALTER TABLE "entregas" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "entregas"
  USING ("graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "entregas"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');
