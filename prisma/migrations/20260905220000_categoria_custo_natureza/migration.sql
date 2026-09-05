-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A2 da Parte 4 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md, "Financeiro"): só o pré-requisito barato
-- da proposta (classificação de natureza fixo/variável/semivariável em
-- CategoriaCusto), NÃO o resto (ParametrosGrafica.overheadModo, que muda o
-- cálculo de overhead dentro de comporPreco — fora de escopo). Pré-requisito
-- direto do DRE (achado A3, ver src/lib/dre.ts): sem classificação de
-- natureza não dá pra separar custo variável de custo fixo, nem calcular
-- margem de contribuição ou ponto de equilíbrio.
--
-- 100% aditiva: DEFAULT 'VARIAVEL' preserva o comportamento de toda
-- categoria já cadastrada (nenhuma muda de classificação até a gráfica
-- editar explicitamente na tela de configuração).

-- CreateEnum
CREATE TYPE "NaturezaCusto" AS ENUM ('VARIAVEL', 'FIXO', 'SEMIVARIAVEL');

-- AlterTable
ALTER TABLE "categorias_custo" ADD COLUMN     "natureza" "NaturezaCusto" NOT NULL DEFAULT 'VARIAVEL';
