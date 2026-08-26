-- Migração escrita à mão (drift do Prisma por causa da tabela n8n_chatbot,
-- fora do controle de migrations — NÃO rodar `prisma migrate reset`).
--
-- Achado A3 da auditoria de abrangência (pesquisa-abrangencia-modulos.md):
-- ProcessoSetupPorPeca era o único enum fechado de catálogo sem escape
-- OUTRO, porque estava amarrado 1:1 aos 3 ModeloCalculo homônimos
-- (SERIGRAFIA/SUBLIMACAO/ESTAMPAGEM_QUENTE). Efeito prático: tampografia,
-- gravação a laser, DTG, transfer — processos com a MESMA forma de custo
-- (setup fixo por matriz/clichê/arte + variável por peça, calculado por
-- calcularSetupPorPeca) — não tinham onde ser cadastrados.
--
-- Adiciona ModeloCalculo.PERSONALIZACAO (9º rótulo, chama a mesma
-- calcularSetupPorPeca dos outros 4) + os 4 novos processos nomeados +
-- OUTRO em ProcessoSetupPorPeca, seguindo o mesmo padrão enum-fechado +
-- escape do resto do schema (CategoriaEquipamento, MaterialSubstrato,
-- TipoAdesivo, TipoSerrilha, TipoLaminacao, TipoAcabamentoVerniz,
-- TipoHotStamping) + a coluna de texto pareada
-- MaquinaSetupPorPeca.tipoProcessoOutro.
--
-- Todas as operações são aditivas (ADD VALUE / ADD COLUMN nullable) e não
-- quebram nenhum tenant existente: nenhum valor de enum existente muda de
-- nome, e a coluna nova é opcional.

-- AlterEnum
ALTER TYPE "ModeloCalculo" ADD VALUE 'PERSONALIZACAO';

-- AlterEnum
ALTER TYPE "ProcessoSetupPorPeca" ADD VALUE 'TAMPOGRAFIA';
ALTER TYPE "ProcessoSetupPorPeca" ADD VALUE 'GRAVACAO_LASER';
ALTER TYPE "ProcessoSetupPorPeca" ADD VALUE 'DTG';
ALTER TYPE "ProcessoSetupPorPeca" ADD VALUE 'TRANSFER';
ALTER TYPE "ProcessoSetupPorPeca" ADD VALUE 'OUTRO';

-- AlterTable
ALTER TABLE "maquinas_setup_por_peca" ADD COLUMN     "tipoProcessoOutro" TEXT;
