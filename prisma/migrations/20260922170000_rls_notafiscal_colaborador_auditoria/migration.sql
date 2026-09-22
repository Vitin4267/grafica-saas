-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- RLS real (Fase B) pra mais 3 tabelas — NotaFiscal (documento fiscal),
-- Colaborador (dado pessoal de funcionário), LogAuditoria (integridade
-- da trilha de auditoria entre tenants). Mesmo bloco de 3 policies das
-- migrations anteriores (rls_piloto, rls_lote2), só troca o nome da
-- tabela — nenhuma das 3 tem graficaId nullable, não precisa da variação
-- especial que itens_catalogo usa pro catálogo compartilhado. Nunca usa
-- FORCE ROW LEVEL SECURITY (a migration roda como neondb_owner, que
-- precisa continuar enxergando tudo).
--
-- Chamadas Prisma que precisam ver estas tabelas continuam funcionando
-- sem mudança de código: NotaFiscal já estava em MODELOS_COM_RLS_ATIVO
-- (join-visibility, achado de 2026-09-22); Colaborador/LogAuditoria
-- entram nesta mesma sessão em src/lib/prisma-tenant-guard.ts.

-- AlterTable
ALTER TABLE "notas_fiscais" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notas_fiscais"
  USING ("graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "notas_fiscais"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');
CREATE POLICY allow_insert ON "notas_fiscais"
  FOR INSERT WITH CHECK (TRUE);

-- AlterTable
ALTER TABLE "colaboradores" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "colaboradores"
  USING ("graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "colaboradores"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');
CREATE POLICY allow_insert ON "colaboradores"
  FOR INSERT WITH CHECK (TRUE);

-- AlterTable
ALTER TABLE "logs_auditoria" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "logs_auditoria"
  USING ("graficaId" = current_setting('app.grafica_id', TRUE));
CREATE POLICY bypass_rls ON "logs_auditoria"
  USING (current_setting('app.bypass_rls', TRUE) = 'on');
CREATE POLICY allow_insert ON "logs_auditoria"
  FOR INSERT WITH CHECK (TRUE);
