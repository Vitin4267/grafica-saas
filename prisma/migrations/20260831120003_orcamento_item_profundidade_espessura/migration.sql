-- AlterTable
-- F7 (auditoria de abrangência, Parte 7): OrcamentoItem só tinha
-- larguraCm/alturaCm (2 dimensões). Gráfica de embalagem não conseguia
-- registrar "caixa 20x15x10", corte a laser não registrava espessura da
-- chapa no ITEM vendido (só existia do lado da matéria-prima).
-- Ambos os campos são opcionais e ignorados por 100% dos motores de preço
-- em src/lib/pricing/ hoje — risco zero de mudar preço de ninguém.
-- profundidadeCm segue a mesma unidade canônica de larguraCm/alturaCm (cm).
-- espessuraMm é em MILÍMETRO (chapa é vendida em mm no Brasil).
-- Nome de tabela real é "orcamento_itens" (model OrcamentoItem tem
-- @@map("orcamento_itens")) — não confundir com o nome do model.
ALTER TABLE "orcamento_itens" ADD COLUMN     "profundidadeCm" DECIMAL(8,2),
ADD COLUMN     "espessuraMm" DECIMAL(8,2);
