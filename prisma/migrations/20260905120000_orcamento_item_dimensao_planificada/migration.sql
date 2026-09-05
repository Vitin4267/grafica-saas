-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A11 da auditoria de abrangência (Parte 1/Embalagem-cartonagem,
-- pesquisa-abrangencia-modulos.md): OrcamentoItem.larguraCm/alturaCm
-- alimentam direto o cálculo de nesting (aproveitamento de folha). Numa
-- caixa de 20×15×10cm, o que realmente ocupa a folha de papelão é o
-- DESENVOLVIMENTO DA FACA (a planificação da embalagem aberta, algo como
-- ~55×45cm), não as dimensões do produto acabado fechado (20×15). Sem
-- separar os dois, o custo de uma embalagem sai errado por 2-3×.
--
-- Adiciona "larguraPlanificadaCm"/"alturaPlanificadaCm" em "orcamento_itens":
-- opcionais; quando presentes, o motor avançado (M2/OFFSET/FLEXOGRAFIA/
-- DIGITAL — os únicos que fazem nesting/imposição) usa ESSAS dimensões pro
-- cálculo de aproveitamento de folha; quando ausentes, cai no comportamento
-- de sempre (larguraCm/alturaCm do produto acabado) — ver
-- calcularItemOrcamento em src/lib/orcamento-precificacao.ts.
--
-- Migração 100% aditiva: nenhuma coluna existente muda de tipo/
-- obrigatoriedade, nenhum dado é reescrito. Todo item já existente fica com
-- os campos novos NULL (comportamento de hoje 100% preservado).

-- AlterTable
ALTER TABLE "orcamento_itens"
    ADD COLUMN "larguraPlanificadaCm" DECIMAL(8,2),
    ADD COLUMN "alturaPlanificadaCm" DECIMAL(8,2);
