-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado D2 da Parte 7 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md, "D. Equipe e prestadores externos",
-- 2026-09-04): Fornecedor é só pra compra de matéria-prima (liga em
-- MovimentacaoEstoque/SolicitacaoCompra, sempre via ItemGrafica).
-- Acabamento terceirizado (laminação, encadernação feita por terceiro),
-- logística/despachante avulso e freelancer de design são SERVIÇO
-- recorrente, sem ItemGrafica nenhum pra se ligar — hoje viram Despesa
-- genérica sem estrutura, sem registrar quem prestou o serviço.
--
-- Adiciona:
-- - enum "TipoPrestadorServico": lista fechada + OUTRO (mesmo padrão de
--   TipoFerramental/CategoriaEquipamento/etc.).
-- - tabela "prestadores_servico": cadastro simples do prestador (nome, tipo,
--   CPF/CNPJ, contato) — mesmo padrão pequeno de "fornecedores", mas pro
--   lado de serviço.
--
-- Escopo desta rodada é DELIBERADAMENTE só o cadastro — nenhuma outra
-- tabela (incluindo "despesas") ganha FK pra cá ainda. Ver comentário do
-- enum TipoPrestadorServico no schema pra por quê.
--
-- Migração 100% aditiva: nenhuma tabela/coluna/enum existente muda de
-- nome/tipo/obrigatoriedade, nenhum dado é reescrito. Nenhuma gráfica tem
-- nenhum PrestadorServico cadastrado até que alguém crie um pela nova tela
-- em /configuracoes/prestadores-servico.

-- CreateEnum
CREATE TYPE "TipoPrestadorServico" AS ENUM ('ACABAMENTO', 'LOGISTICA', 'DESIGN', 'OUTRO');

-- CreateTable
CREATE TABLE "prestadores_servico" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoPrestadorServico" NOT NULL,
    "tipoOutro" TEXT,
    "documento" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "observacoes" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prestadores_servico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prestadores_servico_graficaId_idx" ON "prestadores_servico"("graficaId");

-- CreateIndex
CREATE INDEX "prestadores_servico_graficaId_tipo_idx" ON "prestadores_servico"("graficaId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "prestadores_servico_graficaId_nome_key" ON "prestadores_servico"("graficaId", "nome");

-- AddForeignKey
ALTER TABLE "prestadores_servico" ADD CONSTRAINT "prestadores_servico_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
