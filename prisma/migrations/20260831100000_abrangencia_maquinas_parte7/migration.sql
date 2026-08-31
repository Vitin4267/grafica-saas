-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achados A1/A2/A3/A5 da Parte 7 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md, "A. Máquinas e equipamentos
-- cadastráveis") — todos classificados 🟢 Barato, e implementados só na
-- versão CORRIGIDA pela revisão Opus 2026-08-31 (ver comentários no
-- schema.prisma em CategoriaEquipamento/Equipamento):
--
-- - A1 (bordado): a proposta original de ProcessoSetupPorPeca.BORDADO +
--   MaquinaSetupPorPeca.numeroCabecotes foi DESCARTADA por conflitar com o
--   achado A4/Parte 1 (bordado cobra por PONTO da arte, não por peça fixa
--   como calcularSetupPorPeca assume). Entra só como
--   CategoriaEquipamento.BORDADO — cadastro informativo, sem motor de
--   custo, mesmo papel que Equipamento já cumpre pro resto da lista.
-- - A2 (corte e vinco / cartonagem): CategoriaEquipamento.CORTE_VINCO.
-- - A5 (gofradeira/vincadeira): CategoriaEquipamento.VINCADORA.
-- - A3 (impressora de grande formato): Equipamento.larguraMaximaMm +
--   Equipamento.tecnologiaImpressao (texto livre, sem enum fechado —
--   decisão deliberada, mesmo padrão de marca/modelo do model).
--
-- Achado A4 (prensa térmica/estampador) NÃO gera nenhuma mudança de schema:
-- a proposta original (Equipamento.notas) foi corrigida pela revisão Opus
-- porque Equipamento "nunca influencia preço" e o achado descreve
-- diferença real de CUSTO entre tipo de prensa — a correção reaproveita
-- MaquinaSetupPorPeca.custoPorSetup/custoPorPeca (campos já existentes),
-- então não precisa de coluna nova.
--
-- Migração 100% aditiva: nenhum valor de enum existente muda de nome,
-- nenhuma coluna existente muda de tipo/obrigatoriedade, nenhum dado é
-- reescrito. Registros existentes de Equipamento ficam com
-- larguraMaximaMm/tecnologiaImpressao = NULL (comportamento de hoje 100%
-- preservado).

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

ALTER TYPE "CategoriaEquipamento" ADD VALUE 'BORDADO';
ALTER TYPE "CategoriaEquipamento" ADD VALUE 'CORTE_VINCO';
ALTER TYPE "CategoriaEquipamento" ADD VALUE 'VINCADORA';

-- AlterTable
ALTER TABLE "equipamentos" ADD COLUMN     "larguraMaximaMm" INTEGER,
ADD COLUMN     "tecnologiaImpressao" TEXT;
