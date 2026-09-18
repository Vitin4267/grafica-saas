-- Fase B do isolamento multi-tenant (RLS real no Postgres) — Lote 2,
-- expansão depois do piloto de 5 tabelas confirmado estável em produção.
-- Ver ~/.claude/plans/deep-zooming-parasol.md e o migration.sql do piloto
-- (20260917140000_rls_piloto) pro raciocínio completo de cada decisão
-- (sem FORCE ROW LEVEL SECURITY, 3 policies permissivas por tabela,
-- INSERT deliberadamente fora do escopo de tenant_isolation/bypass_rls).

ALTER TABLE "parametros_grafica" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "parametros_grafica"
  USING ("graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "parametros_grafica"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');
CREATE POLICY allow_insert ON "parametros_grafica"
  FOR INSERT WITH CHECK (TRUE);

ALTER TABLE "filiais" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "filiais"
  USING ("graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "filiais"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');
CREATE POLICY allow_insert ON "filiais"
  FOR INSERT WITH CHECK (TRUE);

ALTER TABLE "orcamentos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "orcamentos"
  USING ("graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "orcamentos"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');
CREATE POLICY allow_insert ON "orcamentos"
  FOR INSERT WITH CHECK (TRUE);

ALTER TABLE "fornecedores" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "fornecedores"
  USING ("graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "fornecedores"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');
CREATE POLICY allow_insert ON "fornecedores"
  FOR INSERT WITH CHECK (TRUE);

-- ESPECIAL — "graficaId" é NULLABLE aqui (null = catálogo mestre,
-- compartilhado por design entre TODAS as gráficas; preenchido = item
-- privado de uma gráfica — ver comentário no schema, 06-catalogo.prisma).
-- A policy padrão ("graficaId" = current_setting(...)) esconderia o
-- catálogo mestre inteiro de todo mundo, já que NULL nunca é igual a nada
-- em SQL — isso quebraria a feature de catálogo compartilhado, não é um
-- bug que RLS deveria "corrigir". Por isso o OR extra abaixo.
ALTER TABLE "itens_catalogo" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "itens_catalogo"
  USING ("graficaId" IS NULL OR "graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "itens_catalogo"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');
CREATE POLICY allow_insert ON "itens_catalogo"
  FOR INSERT WITH CHECK (TRUE);

ALTER TABLE "itens_grafica" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "itens_grafica"
  USING ("graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "itens_grafica"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');
CREATE POLICY allow_insert ON "itens_grafica"
  FOR INSERT WITH CHECK (TRUE);

-- ESPECIAL — Usuario tem bypass_rls como caminho normal de escrita, não só
-- excepcional: /registro cria a GRÁFICA em si (src/app/registro/actions.ts,
-- envolvido em semTenant), então o primeiro Usuario de cada gráfica nova
-- SEMPRE nasce sob bypass, nunca sob tenant_isolation — não é um caso raro
-- de cron/token público como os outros usos de semTenant.
ALTER TABLE "usuarios" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "usuarios"
  USING ("graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "usuarios"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');
CREATE POLICY allow_insert ON "usuarios"
  FOR INSERT WITH CHECK (TRUE);

ALTER TABLE "perfis_acesso" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "perfis_acesso"
  USING ("graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "perfis_acesso"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');
CREATE POLICY allow_insert ON "perfis_acesso"
  FOR INSERT WITH CHECK (TRUE);

ALTER TABLE "contas_financeiras" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contas_financeiras"
  USING ("graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "contas_financeiras"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');
CREATE POLICY allow_insert ON "contas_financeiras"
  FOR INSERT WITH CHECK (TRUE);

ALTER TABLE "despesas" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "despesas"
  USING ("graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "despesas"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');
CREATE POLICY allow_insert ON "despesas"
  FOR INSERT WITH CHECK (TRUE);

ALTER TABLE "contas_prepagas" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contas_prepagas"
  USING ("graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "contas_prepagas"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');
CREATE POLICY allow_insert ON "contas_prepagas"
  FOR INSERT WITH CHECK (TRUE);

ALTER TABLE "comissoes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "comissoes"
  USING ("graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "comissoes"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');
CREATE POLICY allow_insert ON "comissoes"
  FOR INSERT WITH CHECK (TRUE);

ALTER TABLE "regras_comissao" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "regras_comissao"
  USING ("graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "regras_comissao"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');
CREATE POLICY allow_insert ON "regras_comissao"
  FOR INSERT WITH CHECK (TRUE);

ALTER TABLE "categorias_custo" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "categorias_custo"
  USING ("graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "categorias_custo"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');
CREATE POLICY allow_insert ON "categorias_custo"
  FOR INSERT WITH CHECK (TRUE);

ALTER TABLE "custos_pedido" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "custos_pedido"
  USING ("graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "custos_pedido"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');
CREATE POLICY allow_insert ON "custos_pedido"
  FOR INSERT WITH CHECK (TRUE);
