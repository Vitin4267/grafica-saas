-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado D1 da auditoria de abrangência (Parte 4/Qualidade-pessoas,
-- pesquisa-abrangencia-modulos.md, "Sem conceito de 'colaborador sem
-- login'"): motorista terceirizado e operador de chão de fábrica hoje só
-- existem como texto livre solto (Entrega.motorista,
-- ApontamentoEtapa.operadorNomeDeclarado), sem cadastro reaproveitável.
--
-- Nota: a "Proposta" original do achado ("relaxar email/senhaHash de
-- Usuario") foi REJEITADA numa revisão posterior — contaminaria toda a
-- cadeia de auth/sessão/billing. Esta migration segue a direção do "Custo
-- estimado" do achado: model NOVO e simples, nunca mexe em "usuarios".
--
-- Adiciona:
-- - enum "TipoColaborador": lista fechada + OUTRO (mesmo padrão de
--   TipoPrestadorServico/TipoFerramental/etc.).
-- - tabela "colaboradores": cadastro simples (nome, tipo, telefone, ativo) —
--   mesmo formato enxuto de "transportadoras"/"prestadores_servico", mas
--   SEM unique(graficaId, nome) de propósito (nome de PESSOA, não de
--   empresa — duas pessoas com o mesmo nome é caso real).
-- - coluna "motoristaColaboradorId" em "entregas": FK opcional, ADITIVA ao
--   texto livre "motorista" já existente (mesmo padrão de
--   "transportadoraId"/"contatoClienteId" — convive lado a lado, nunca
--   substitui).
--
-- Migração 100% aditiva: nenhuma tabela/coluna existente muda de
-- tipo/obrigatoriedade, nenhum dado é reescrito. Toda entrega já existente
-- fica com "motoristaColaboradorId" NULL (comportamento de hoje 100%
-- preservado) e nenhuma gráfica tem nenhum Colaborador cadastrado até que
-- alguém crie um pela nova tela em /configuracoes/colaboradores.

-- CreateEnum
CREATE TYPE "TipoColaborador" AS ENUM ('MOTORISTA', 'OPERADOR_CHAO_FABRICA', 'OUTRO');

-- CreateTable
CREATE TABLE "colaboradores" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoColaborador" NOT NULL DEFAULT 'OUTRO',
    "tipoOutro" TEXT,
    "telefone" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "colaboradores_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "entregas"
    ADD COLUMN "motoristaColaboradorId" TEXT;

-- CreateIndex
CREATE INDEX "colaboradores_graficaId_idx" ON "colaboradores"("graficaId");

-- CreateIndex
CREATE INDEX "colaboradores_graficaId_tipo_idx" ON "colaboradores"("graficaId", "tipo");

-- CreateIndex
CREATE INDEX "entregas_motoristaColaboradorId_idx" ON "entregas"("motoristaColaboradorId");

-- AddForeignKey
ALTER TABLE "colaboradores" ADD CONSTRAINT "colaboradores_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entregas" ADD CONSTRAINT "entregas_motoristaColaboradorId_fkey" FOREIGN KEY ("motoristaColaboradorId") REFERENCES "colaboradores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
