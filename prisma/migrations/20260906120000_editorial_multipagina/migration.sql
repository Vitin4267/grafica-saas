-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A10 (rota 1) da Parte 1 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md, 2026-09-06): "Editorial multipágina não
-- é representável — 7 produtos do catálogo mestre são inutilizáveis no
-- motor" (Revista, Catálogo, Livro Brochura, Livro Capa Dura, Apostila,
-- Encadernação Espiral, Wire-o). O motor OFFSET assume uma peça plana única
-- (um papelId, uma gramatura, um corFrente/corVerso) — um livro precisa de
-- MIOLO e CAPA com papel/gramatura/cores PRÓPRIOS, nº de páginas e
-- encadernação. Rota 1 (específica) construída — Rota 2 (item de orçamento
-- composto, itemPaiId, transversal a dezenas de call-sites) deliberadamente
-- FORA DE ESCOPO desta rodada.
--
-- Adiciona:
-- - ModeloCalculo.EDITORIAL (13º rótulo).
-- - enum "TipoEncadernacaoEditorial" (COLADA_HOTMELT/PUR/COSTURADA/
--   GRAMPO_CANOA/WIRE_O/ESPIRAL/CAPA_DURA/OUTRO) — DELIBERADAMENTE separado
--   do enum "TipoEncadernacao" já existente (ItemGrafica.tipoEncadernacao,
--   achado C5, puramente descritivo, nunca lido por src/lib/pricing/): este
--   novo é referenciado por OrcamentoItem, valores mais granulares
--   específicos de encadernação de livro (ver comentário no schema).
-- - colunas "custoImpressaoM2Editorial"/"custoEncadernacaoPorPeca" em
--   "itens_grafica" — só relevantes quando modeloCalculo=EDITORIAL.
-- - coluna "paginasPorCadernoPadrao" em "parametros_grafica" (default 16 —
--   caderno/signature mais comum do mercado brasileiro, configurável por
--   tenant).
-- - colunas em "orcamento_itens": "numeroPaginas" (miolo), "tipoEncadernacao"/
--   "tipoEncadernacaoOutro" (snapshot informativo), "temOrelhas"/
--   "larguraOrelhaCm" (afeta a largura da capa aberta), e papel/gramatura/
--   cores do MIOLO e da CAPA como campos DIRETOS (duplicando com sufixo
--   Miolo/Capa os campos que o Offset já tem — sem model de override
--   separado, porque EDITORIAL não tem papel/gramatura fixos no PRODUTO pra
--   sobrepor: cada orçamento escolhe os dois papéis do zero).
--
-- Migração 100% aditiva: nenhuma tabela/coluna/enum existente muda de
-- nome/tipo/obrigatoriedade, nenhum dado é reescrito. Todo produto/item de
-- orçamento já existente fica com modeloCalculo/campos novos em NULL
-- (comportamento de hoje 100% preservado) até que alguém configure um
-- produto EDITORIAL pela tela de Catálogo.

-- CreateEnum
CREATE TYPE "TipoEncadernacaoEditorial" AS ENUM ('COLADA_HOTMELT', 'PUR', 'COSTURADA', 'GRAMPO_CANOA', 'WIRE_O', 'ESPIRAL', 'CAPA_DURA', 'OUTRO');

-- AlterEnum
ALTER TYPE "ModeloCalculo" ADD VALUE 'EDITORIAL';

-- AlterTable
ALTER TABLE "itens_grafica" ADD COLUMN     "custoImpressaoM2Editorial" DECIMAL(12,4),
ADD COLUMN     "custoEncadernacaoPorPeca" DECIMAL(12,4);

-- AlterTable
ALTER TABLE "parametros_grafica" ADD COLUMN     "paginasPorCadernoPadrao" INTEGER NOT NULL DEFAULT 16;

-- AlterTable
ALTER TABLE "orcamento_itens" ADD COLUMN     "numeroPaginas" INTEGER,
ADD COLUMN     "tipoEncadernacao" "TipoEncadernacaoEditorial",
ADD COLUMN     "tipoEncadernacaoOutro" TEXT,
ADD COLUMN     "temOrelhas" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "larguraOrelhaCm" DECIMAL(8,2),
ADD COLUMN     "papelMioloId" TEXT,
ADD COLUMN     "gramaturaMioloGm2" DECIMAL(6,1),
ADD COLUMN     "coresMiolo" TEXT,
ADD COLUMN     "papelCapaId" TEXT,
ADD COLUMN     "gramaturaCapaGm2" DECIMAL(6,1),
ADD COLUMN     "coresCapa" TEXT;

-- CreateIndex
CREATE INDEX "orcamento_itens_papelMioloId_idx" ON "orcamento_itens"("papelMioloId");

-- CreateIndex
CREATE INDEX "orcamento_itens_papelCapaId_idx" ON "orcamento_itens"("papelCapaId");

-- AddForeignKey
ALTER TABLE "orcamento_itens" ADD CONSTRAINT "orcamento_itens_papelMioloId_fkey" FOREIGN KEY ("papelMioloId") REFERENCES "itens_grafica"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_itens" ADD CONSTRAINT "orcamento_itens_papelCapaId_fkey" FOREIGN KEY ("papelCapaId") REFERENCES "itens_grafica"("id") ON DELETE SET NULL ON UPDATE CASCADE;
