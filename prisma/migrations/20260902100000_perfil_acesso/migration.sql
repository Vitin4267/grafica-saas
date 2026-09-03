-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A5 da auditoria de abrangência (Parte 6/Configurações,
-- pesquisa-abrangencia-modulos.md, 2026-08-27): PermissaoUsuario é
-- [usuarioId, modulo] — controle fino só se aplica a OPERADOR (DONO/ADMIN
-- sempre têm acesso total, não consultam banco nenhum, ver
-- src/lib/auth/permissoes.ts). Configurar módulo por módulo por pessoa é
-- repetitivo pra gráfica com vários operadores da mesma função (ex: 3 de
-- acabamento no mesmo turno), sem "copiar de outro usuário" nem perfil
-- reutilizável.
--
-- Adiciona:
-- - tabela "perfis_acesso": perfil reutilizável por gráfica (ex:
--   "Impressor", "Acabamento", "Vendedor externo").
-- - tabela "permissoes_perfil": grade módulo × podeVer/podeEditar de cada
--   perfil (mesmo formato de "permissoes_usuario", só que por perfil em vez
--   de por usuário).
-- - coluna "perfilAcessoId" em "usuarios" (nullable, FK ON DELETE SET NULL):
--   null preserva 100% o comportamento de hoje (só PermissaoUsuario
--   individual). Apagar um PerfilAcesso nunca apaga usuário nem trava a
--   exclusão do perfil — o usuário só perde o perfil e volta a depender
--   exclusivamente do override individual.
--
-- Migração 100% aditiva: nenhuma tabela/coluna existente muda de
-- tipo/obrigatoriedade, nenhum dado é reescrito. PermissaoUsuario continua
-- exatamente como está e continua vencendo o perfil quando as duas coexistem
-- pro mesmo usuário+módulo — ver resolverPermissaoOperador em
-- src/lib/auth/permissoes.ts pra ordem exata de resolução.

-- CreateTable
CREATE TABLE "perfis_acesso" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,

    CONSTRAINT "perfis_acesso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "perfis_acesso_graficaId_idx" ON "perfis_acesso"("graficaId");

-- CreateIndex
CREATE UNIQUE INDEX "perfis_acesso_graficaId_nome_key" ON "perfis_acesso"("graficaId", "nome");

-- AddForeignKey
ALTER TABLE "perfis_acesso" ADD CONSTRAINT "perfis_acesso_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "permissoes_perfil" (
    "id" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "modulo" "ModuloPermissao" NOT NULL,
    "podeVer" BOOLEAN NOT NULL DEFAULT false,
    "podeEditar" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "permissoes_perfil_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "permissoes_perfil_perfilId_modulo_key" ON "permissoes_perfil"("perfilId", "modulo");

-- AddForeignKey
ALTER TABLE "permissoes_perfil" ADD CONSTRAINT "permissoes_perfil_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "perfis_acesso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN "perfilAcessoId" TEXT;

-- CreateIndex
CREATE INDEX "usuarios_perfilAcessoId_idx" ON "usuarios"("perfilAcessoId");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_perfilAcessoId_fkey" FOREIGN KEY ("perfilAcessoId") REFERENCES "perfis_acesso"("id") ON DELETE SET NULL ON UPDATE CASCADE;
