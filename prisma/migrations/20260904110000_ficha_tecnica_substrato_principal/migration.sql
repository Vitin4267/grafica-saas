-- Achado N5 da auditoria de código (2026-09-04) — marca qual linha de
-- FichaTecnicaItem é o substrato/papel PRINCIPAL que o motor avançado
-- (OFFSET/M2/FLEXOGRAFIA) efetivamente dimensiona pela imposição/nesting,
-- pra que a baixa de estoque possa usar o consumo FÍSICO real do breakdown
-- (folhasTotais/areaFaturavel/metragemLinearM) em vez do consumo linear
-- (quantidadePorUnidade × quantidade) só nessa linha. Ver comentário do
-- campo em prisma/schema/06-catalogo.prisma e src/lib/baixa-estoque-substrato.ts.

-- AlterTable
ALTER TABLE "ficha_tecnica_itens" ADD COLUMN "ehSubstratoPrincipal" BOOLEAN NOT NULL DEFAULT false;
