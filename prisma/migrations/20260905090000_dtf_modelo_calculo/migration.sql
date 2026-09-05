-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A5 da Parte 1 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md, "DTF está classificado como o processo
-- errado"): DTF (Direct to Film — transfer têxtil) existia só como SERVICO
-- no catálogo mestre, sem ModeloCalculo próprio — a gráfica caía em
-- SUBLIMACAO (setup-por-peça), que erra por construção: DTF não tem
-- tela/matriz por arte (setup tende a zero) e o custo real é POR METRO
-- LINEAR DE FILME, com múltiplas artes "gangadas" no mesmo metro — a forma
-- de custo é a do M2 (nesting em bobina), não a de setup-por-peça.
--
-- Adiciona:
-- - ModeloCalculo.DTF (13º rótulo) — aponta pro MESMO calcularM2 que M2 usa
--   (ver src/lib/pricing/precificar.ts), sem motor novo.
-- - colunas "custoSubstratoPorPeca"/"custoPrensagemPorPeca" em
--   "itens_grafica" — custo por PEÇA da camiseta/substrato e da prensagem
--   térmica, somados (× quantidade) ao custoBase do calcularM2
--   compartilhado. NULL em todo produto existente (M2 ou qualquer outro
--   modelo) — o cálculo trata NULL como 0 (ver
--   src/lib/pricing/carregar.ts), nenhuma regressão pra quem já usa M2 puro.
--
-- Migração 100% aditiva: nenhuma tabela/coluna/enum existente muda de
-- nome/tipo/obrigatoriedade, nenhum dado é reescrito. Todo produto já
-- existente fica com os dois campos novos em NULL (comportamento de hoje
-- 100% preservado) e nenhuma gráfica tem nenhum produto DTF até que alguém
-- escolha esse modelo pela tela de configuração do produto.

-- AlterEnum
ALTER TYPE "ModeloCalculo" ADD VALUE 'DTF';

-- AlterTable
ALTER TABLE "itens_grafica" ADD COLUMN     "custoSubstratoPorPeca" DECIMAL(12,4),
ADD COLUMN     "custoPrensagemPorPeca" DECIMAL(12,4);
