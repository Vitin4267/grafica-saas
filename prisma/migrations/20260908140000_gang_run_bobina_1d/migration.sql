-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente). SQL abaixo conferido com `prisma migrate diff
-- --from-config-datasource --to-schema prisma/schema --script` (comando
-- read-only, não aplica nada) contra o schema novo — removidas duas linhas
-- de DRIFT pré-existente e sem relação com este achado que o diff também
-- reportou (`clientes.updatedAt DROP DEFAULT`, `DROP TABLE "n8n_chatbot"`)
-- — nenhuma delas faz parte desta mudança, não entram aqui.
--
-- Achado F1 da auditoria de abrangência (pesquisa-abrangencia-modulos.md,
-- "F. Escopo travado no perfil da gráfica de referência", "Gang run só
-- existe para OFFSET"): generaliza FilaGangRun/GrupoGangRun pra além de
-- Offset. Ganging (agrupar jobs pequenos de pedidos diferentes numa mesma
-- peça física pra dividir custo fixo de setup) é uma técnica de
-- APROVEITAMENTO DE SUBSTRATO, não exclusiva de offset.
--
-- Adiciona:
-- - enum "TipoAgrupamentoGangRun": FOLHA_2D (Offset, comportamento
--   original) / BOBINA_1D (Flexografia/grande formato, novo nesta rodada)
--   / TELA_MATRIZ / MESA_PLANA (os dois últimos reservados, SEM lógica de
--   compatibilidade implementada ainda — próximo passo) / OUTRO.
-- - "fila_gang_run"."tipoAgrupamento" (NOT NULL DEFAULT 'FOLHA_2D' — toda
--   linha existente é candidato Offset, preserva 100% o comportamento de
--   hoje).
-- - "fila_gang_run"."itemGraficaMaterialId" / "larguraBobinaNominal" /
--   "maquinaFlexografiaId" (todas NULLABLE) — chave de compatibilidade
--   BOBINA_1D, preenchida só por candidatos Flexografia.
-- - Mesmas 4 colunas em "grupos_gang_run" (espelha FilaGangRun).
-- - Índice novo em "fila_gang_run" pros 3 campos de compatibilidade
--   BOBINA_1D + status (mesmo padrão do índice composto já existente pro
--   FOLHA_2D).
--
-- Relaxa (NÃO é 100% aditivo no sentido estrito — documentado
-- explicitamente aqui, seguindo o mesmo padrão já usado em
-- 20260906150000_compras_tipo_e_custo_aquisicao/"itemGraficaId" DROP NOT
-- NULL): em "fila_gang_run" E "grupos_gang_run", as 6 colunas
-- "papelId"/"gramaturaGm2"/"prensaId"/"folhaId"/"corFrente"/"corVerso"
-- (a chave de compatibilidade FOLHA_2D, "prensaId" inclusive — achado F1
-- pedia isso especificamente) deixam de ser NOT NULL. Relaxar NOT NULL
-- nunca quebra dado existente: toda linha FOLHA_2D já tem as 6 preenchidas
-- (nenhuma vira NULL retroativamente), a mudança só abre espaço pra uma
-- linha BOBINA_1D nova não precisar preenchê-las. Nenhuma FK formal existe
-- pra esses campos (é um snapshot de agrupamento, ver comentário no
-- schema), então não há constraint de FK pra recriar.
--
-- custoChapasIndividual/custoSetupIndividual (fila_gang_run) e
-- custoChapasTotal/custoSetupTotal (grupos_gang_run) NÃO mudam de tipo —
-- continuam NOT NULL, reaproveitados como estão pros dois tipos
-- (candidatos/grupos BOBINA_1D gravam custoChapasIndividual/
-- custoChapasTotal = 0.00, sem custo de "chapa" individual neste MVP; ver
-- comentário em registrarCandidatosGangRun, src/lib/gang-run-servico.ts).
--
-- TipoAgrupamentoGangRun é um enum NOVO (não adiciona valor a um enum já
-- existente), então não há restrição de transação separada (ALTER TYPE
-- ... ADD VALUE só é problema pra enum JÁ existente usado na mesma
-- transação).

-- CreateEnum
CREATE TYPE "TipoAgrupamentoGangRun" AS ENUM ('FOLHA_2D', 'BOBINA_1D', 'TELA_MATRIZ', 'MESA_PLANA', 'OUTRO');

-- AlterTable
ALTER TABLE "fila_gang_run" ADD COLUMN     "itemGraficaMaterialId" TEXT,
ADD COLUMN     "larguraBobinaNominal" DECIMAL(6,3),
ADD COLUMN     "maquinaFlexografiaId" TEXT,
ADD COLUMN     "tipoAgrupamento" "TipoAgrupamentoGangRun" NOT NULL DEFAULT 'FOLHA_2D',
ALTER COLUMN "papelId" DROP NOT NULL,
ALTER COLUMN "gramaturaGm2" DROP NOT NULL,
ALTER COLUMN "prensaId" DROP NOT NULL,
ALTER COLUMN "folhaId" DROP NOT NULL,
ALTER COLUMN "corFrente" DROP NOT NULL,
ALTER COLUMN "corVerso" DROP NOT NULL;

-- AlterTable
ALTER TABLE "grupos_gang_run" ADD COLUMN     "itemGraficaMaterialId" TEXT,
ADD COLUMN     "larguraBobinaNominal" DECIMAL(6,3),
ADD COLUMN     "maquinaFlexografiaId" TEXT,
ADD COLUMN     "tipoAgrupamento" "TipoAgrupamentoGangRun" NOT NULL DEFAULT 'FOLHA_2D',
ALTER COLUMN "papelId" DROP NOT NULL,
ALTER COLUMN "gramaturaGm2" DROP NOT NULL,
ALTER COLUMN "prensaId" DROP NOT NULL,
ALTER COLUMN "folhaId" DROP NOT NULL,
ALTER COLUMN "corFrente" DROP NOT NULL,
ALTER COLUMN "corVerso" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "fila_gang_run_graficaId_itemGraficaMaterialId_larguraBobina_idx" ON "fila_gang_run"("graficaId", "itemGraficaMaterialId", "larguraBobinaNominal", "maquinaFlexografiaId", "status");
