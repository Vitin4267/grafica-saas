-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado C5 da auditoria de abrangência (pesquisa-abrangencia-modulos.md,
-- Parte 7 — Completude de cadastro, 2026-09-04): os únicos enums
-- estruturados de acabamento (TipoAdesivo/TipoSerrilha/TipoLaminacao/
-- TipoAcabamentoVerniz/TipoHotStamping) só existiam em
-- OrcamentoItemEtiqueta — o motor M2/flexografia de rótulo. Fora de
-- etiqueta (embalagem, livro/editorial, comunicação visual, brinde), não
-- existia NENHUM dropdown estruturado de acabamento: a gráfica cadastrava
-- um SERVICO com nome livre.
--
-- Adiciona 3 enums novos (TipoDobra/TipoEncadernacao/TipoColagem, mesmo
-- padrão fechado+OUTRO dos enums de etiqueta) e 6 colunas opcionais em
-- "itens_grafica" (3 enums + 3 campos "*Outro" de texto livre, usados só
-- quando o enum correspondente = OUTRO). Puramente descritivo/
-- organizacional — NUNCA lido por src/lib/pricing/, nunca entra em nenhum
-- cálculo de custo/preço (mesmo espírito do achado N14/EstagioAcabamento).
--
-- Migração 100% aditiva: nenhuma tabela/coluna/enum existente muda de
-- nome/tipo/obrigatoriedade, nenhum dado é reescrito. Todo ItemGrafica já
-- existente fica com as 6 colunas novas em NULL (comportamento atual 100%
-- preservado).

-- CreateEnum
CREATE TYPE "TipoDobra" AS ENUM ('MEIA_DOBRA', 'SANFONA', 'CARTA', 'PARALELA', 'OUTRO');

-- CreateEnum
CREATE TYPE "TipoEncadernacao" AS ENUM ('BROCHURA', 'WIRE_O', 'ESPIRAL', 'CAPA_DURA', 'OUTRO');

-- CreateEnum
CREATE TYPE "TipoColagem" AS ENUM ('COLA_FRIA', 'COLA_QUENTE', 'PUR', 'OUTRO');

-- AlterTable
ALTER TABLE "itens_grafica"
  ADD COLUMN "tipoDobra" "TipoDobra",
  ADD COLUMN "tipoDobraOutro" TEXT,
  ADD COLUMN "tipoEncadernacao" "TipoEncadernacao",
  ADD COLUMN "tipoEncadernacaoOutro" TEXT,
  ADD COLUMN "tipoColagem" "TipoColagem",
  ADD COLUMN "tipoColagemOutro" TEXT;
