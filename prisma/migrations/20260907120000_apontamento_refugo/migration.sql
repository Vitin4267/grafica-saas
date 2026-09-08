-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado B3 da auditoria de abrangência (Parte 2/Produção,
-- pesquisa-abrangencia-modulos.md, 2026-09-07): o sistema capturava perda
-- exatamente UMA vez, na transição CLICHE_FACA→PRODUCAO
-- (resolverPerdasConfirmadas/ItemGrafica.perdaFixaPadrao), e o que modela é
-- perda de CALIBRAGEM/acerto de máquina. Refugo real de produção (folhas
-- cortadas errado, peça com defeito, falha de tinta no meio de uma bobina)
-- não tinha onde ser registrado depois disso.
--
-- Adiciona:
-- - enum "MotivoRefugo": ACERTO_MAQUINA / ERRO_REGISTRO_COR /
--   FALHA_IMPRESSAO / ERRO_CORTE_REFILE / FALHA_ACABAMENTO /
--   MATERIAL_DEFEITUOSO / ERRO_ARTE_ARQUIVO / ERRO_OPERACIONAL / OUTRO.
-- - 4 colunas em "apontamentos_etapa": "quantidadeBoa" (Int?),
--   "quantidadeRefugo" (Int?), "motivoRefugo" ("MotivoRefugo"?),
--   "motivoRefugoOutro" (Text?).
--
-- Migração 100% aditiva: todas as colunas novas são NULLABLE, sem DEFAULT
-- que force reescrita — todo apontamento existente fica com os 4 campos
-- null (equivalente a "refugo não reportado"), nenhum comportamento antigo
-- muda.

-- CreateEnum
CREATE TYPE "MotivoRefugo" AS ENUM ('ACERTO_MAQUINA', 'ERRO_REGISTRO_COR', 'FALHA_IMPRESSAO', 'ERRO_CORTE_REFILE', 'FALHA_ACABAMENTO', 'MATERIAL_DEFEITUOSO', 'ERRO_ARTE_ARQUIVO', 'ERRO_OPERACIONAL', 'OUTRO');

-- AlterTable
ALTER TABLE "apontamentos_etapa" ADD COLUMN     "quantidadeBoa" INTEGER,
ADD COLUMN     "quantidadeRefugo" INTEGER,
ADD COLUMN     "motivoRefugo" "MotivoRefugo",
ADD COLUMN     "motivoRefugoOutro" TEXT;
