-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado F4 da auditoria de abrangência (pesquisa-abrangencia-modulos.md,
-- Parte 7, 2026-09-05): "Estoque sem lote/validade — schema já cita
-- exigência que não consegue atender". Cliente.preferenciasProducao já usa
-- como exemplo real "não aceita variação de tom entre lotes", mas
-- MovimentacaoEstoque não tinha onde registrar de qual lote a matéria-prima
-- saiu. Também sem alerta de validade (a mecânica de alerta de estoque
-- baixo já existia, só faltava o dado) e sem certificação de cadeia de
-- custódia (FSC/PEFC).
--
-- 1) "itens_grafica": +1 coluna boolean opt-in (controlaLote, default
--    false — comportamento de hoje preservado pra todo item existente e
--    novo) + 1 enum novo fechado+OUTRO (certificacao) + seu campo
--    "*Outro" de texto livre.
-- 2) "movimentacoes_estoque": +2 colunas opcionais (lote texto livre,
--    validade DATE) — preenchidas na ENTRADA_COMPRA e copiadas como
--    snapshot na SAIDA_PRODUCAO correspondente (ver comentário no schema
--    e em snapshotLoteFicha, src/app/producao/status-transicao.ts).
-- 3) "parametros_grafica": +1 coluna Int com default (
--    diasAlertaValidadeEstoque) — limiar configurável por gráfica do
--    alerta de validade de lote, mesmo padrão de
--    diasPrecoInsumoDesatualizado/diasAlertaCompraPadrao já existentes.
--
-- Migração 100% aditiva: nenhuma tabela/coluna/enum existente muda de
-- nome/tipo/obrigatoriedade, nenhum dado é reescrito. Todo registro já
-- existente fica com as colunas novas em NULL (lote/validade/certificacao/
-- certificacaoOutro) ou no default (controlaLote=false,
-- diasAlertaValidadeEstoque=30) — zero regressão pra quem nunca usa lote.

-- CreateEnum
CREATE TYPE "CertificacaoMaterial" AS ENUM ('FSC', 'PEFC', 'NENHUMA', 'OUTRO');

-- AlterTable
ALTER TABLE "itens_grafica"
  ADD COLUMN "controlaLote" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "certificacao" "CertificacaoMaterial",
  ADD COLUMN "certificacaoOutro" TEXT;

-- AlterTable
ALTER TABLE "movimentacoes_estoque"
  ADD COLUMN "lote" TEXT,
  ADD COLUMN "validade" DATE;

-- AlterTable
ALTER TABLE "parametros_grafica"
  ADD COLUMN "diasAlertaValidadeEstoque" INTEGER NOT NULL DEFAULT 30;
