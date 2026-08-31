-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado F9 da Parte 7 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md, "F. Documento e transação") —
-- classificado 🟢 Barato: `SegmentoGrafica` não tinha SERIGRAFIA nem
-- FLEXOGRAFIA (apesar de ambos terem ModeloCalculo próprio no motor de
-- preço), nem BORDADO/PAPELARIA_CONVITES/SINALIZACAO_ADESIVAGEM. Mais
-- grave: `Grafica.segmento` é campo ÚNICO, mas gráfica real quase nunca é
-- uma coisa só (offset + gráfica rápida + comunicação visual no mesmo CNPJ
-- é a norma).
--
-- Migração 100% aditiva: nenhum valor de enum existente muda de nome,
-- `segmento`/`segmentoOutro` continuam exatamente como estavam (nenhuma
-- migração de dado, nenhuma mudança de comportamento pra tenant existente).
-- `segmentosSecundarios` nasce como array vazio (default '{}') pra toda
-- gráfica — mesmo comportamento de hoje até a gráfica escolher algo em
-- /configuracoes/identidade.
--
-- Regra de ouro (mesma do campo `segmento`, documentada no schema): tanto os
-- 5 valores novos quanto a coluna `segmentosSecundarios` são DESCRITIVOS,
-- nunca RESTRITIVOS — nenhum código pode usar isso pra esconder/bloquear
-- card, menu ou feature (ver correção de E1/E2 no mesmo documento).

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

ALTER TYPE "SegmentoGrafica" ADD VALUE 'SERIGRAFIA';
ALTER TYPE "SegmentoGrafica" ADD VALUE 'FLEXOGRAFIA';
ALTER TYPE "SegmentoGrafica" ADD VALUE 'BORDADO';
ALTER TYPE "SegmentoGrafica" ADD VALUE 'PAPELARIA_CONVITES';
ALTER TYPE "SegmentoGrafica" ADD VALUE 'SINALIZACAO_ADESIVAGEM';

-- AlterTable
ALTER TABLE "graficas" ADD COLUMN     "segmentosSecundarios" "SegmentoGrafica"[] NOT NULL DEFAULT ARRAY[]::"SegmentoGrafica"[];
