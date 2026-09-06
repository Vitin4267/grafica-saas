-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Feature "cargos com permissão pré-configurada (multi-cargo por usuário) +
-- vendedor real no orçamento" (2026-09-06). Duas mudanças de schema
-- independentes, na mesma migration porque foram planejadas/construídas
-- juntas:
--
-- 1. Usuario.perfilAcessoId (FK ÚNICA pra PerfilAcesso) vira uma tabela de
--    junção N:N "perfis_usuario" — um usuário pode ter VÁRIOS cargos ao
--    mesmo tempo (ex: Vendedor E Financeiro), permissão somada por união
--    (ver resolverPermissaoOperador/obterModulosVisiveis em
--    src/lib/auth/permissoes.ts). PASSO CRÍTICO DE DADOS: toda linha
--    "usuarios"."perfilAcessoId" != null é migrada pra uma linha em
--    "perfis_usuario" ANTES de a coluna antiga ser dropada — zero usuário
--    perde o(s) perfil(is) que já tinha. gen_random_uuid() (built-in do
--    Postgres desde a v13, sem precisar de extensão) só gera um id opaco
--    pra cada linha nova — a coluna "id" é TEXT livre, não precisa ter o
--    formato cuid() que o Prisma Client gera em runtime.
--
--    PerfilAcesso ganha também "funcaoBase" (enum novo FuncaoPerfil,
--    nullable) — marca os 6 perfis PRÉ-SEMEADOS (Vendedor, Financeiro,
--    Produção, Compras, Administrativo, Atendimento — ver
--    garantirPerfisAcessoPadrao em src/lib/perfis-acesso-padrao.ts) com sua
--    função de negócio, distinto do nome (que o DONO pode renomear
--    livremente). null pra todo perfil já existente (customizado, ou
--    pré-semeado antes desta migration) — sem regressão nenhuma.
--
-- 2. Orcamento ganha "vendedorUsuarioId" (FK opcional pra Usuario, mesmo
--    padrão de condicaoPagamentoId/transportadoraId): quando o vendedor
--    escolhe um usuário cadastrado (com cargo Vendedor, ou DONO/ADMIN) em
--    vez de digitar o campo `vendedor` (texto livre) à mão. 100% aditivo,
--    nenhum dado a migrar (coluna nova nasce sempre null).
--
-- Nenhuma tabela/coluna existente muda de tipo/obrigatoriedade além da
-- remoção deliberada de "usuarios"."perfilAcessoId" (só depois de migrada).

-- CreateEnum
CREATE TYPE "FuncaoPerfil" AS ENUM ('VENDEDOR', 'FINANCEIRO', 'PRODUCAO', 'COMPRAS', 'ADMINISTRATIVO', 'ATENDIMENTO');

-- AlterTable
ALTER TABLE "perfis_acesso" ADD COLUMN "funcaoBase" "FuncaoPerfil";

-- CreateTable
CREATE TABLE "perfis_usuario" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "perfilAcessoId" TEXT NOT NULL,

    CONSTRAINT "perfis_usuario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "perfis_usuario_usuarioId_idx" ON "perfis_usuario"("usuarioId");

-- CreateIndex
CREATE INDEX "perfis_usuario_perfilAcessoId_idx" ON "perfis_usuario"("perfilAcessoId");

-- CreateIndex
CREATE UNIQUE INDEX "perfis_usuario_usuarioId_perfilAcessoId_key" ON "perfis_usuario"("usuarioId", "perfilAcessoId");

-- AddForeignKey
ALTER TABLE "perfis_usuario" ADD CONSTRAINT "perfis_usuario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfis_usuario" ADD CONSTRAINT "perfis_usuario_perfilAcessoId_fkey" FOREIGN KEY ("perfilAcessoId") REFERENCES "perfis_acesso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migração de dados (PASSO CRÍTICO — ver comentário no topo do arquivo):
-- toda linha "usuarios"."perfilAcessoId" != null vira uma linha em
-- "perfis_usuario" ANTES de a coluna antiga ser removida abaixo.
INSERT INTO "perfis_usuario" ("id", "usuarioId", "perfilAcessoId")
SELECT gen_random_uuid()::text, "id", "perfilAcessoId"
FROM "usuarios"
WHERE "perfilAcessoId" IS NOT NULL;

-- DropForeignKey (coluna antiga, substituída por "perfis_usuario" acima)
ALTER TABLE "usuarios" DROP CONSTRAINT "usuarios_perfilAcessoId_fkey";

-- DropIndex
DROP INDEX "usuarios_perfilAcessoId_idx";

-- AlterTable
ALTER TABLE "usuarios" DROP COLUMN "perfilAcessoId";

-- AlterTable (achado do dono, 2026-09-06 — vendedor real no orçamento)
ALTER TABLE "orcamentos" ADD COLUMN "vendedorUsuarioId" TEXT;

-- CreateIndex
CREATE INDEX "orcamentos_vendedorUsuarioId_idx" ON "orcamentos"("vendedorUsuarioId");

-- AddForeignKey
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_vendedorUsuarioId_fkey" FOREIGN KEY ("vendedorUsuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
