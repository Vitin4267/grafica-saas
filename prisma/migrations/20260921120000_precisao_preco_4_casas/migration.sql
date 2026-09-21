-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado da auditoria de precificação (2026-09-21) — OrcamentoItem.
-- precoUnitario/ItemGrafica.precoVenda só guardavam 2 casas decimais, e o
-- motor de precificação (src/lib/pricing/compor.ts, src/lib/orcamento.ts)
-- arredondava o preço UNITÁRIO pra 2 casas antes de derivar o total — pra
-- produto de alto volume/baixo valor unitário (ex: etiqueta a R$0,068/un),
-- isso perdia ~3% de precisão numa tiragem de dezenas de milhares. Ver
-- pesquisa-calculos-grafica-mercado.md (princípio: precisão do unitário
-- sempre >= precisão do total) e o plano em
-- ~/.claude/plans/deep-zooming-parasol.md pro resto do contexto.
--
-- SEMPRE alargamento (numeric(12,2) -> numeric(12,4)), nunca redução —
-- Postgres faz isso instantaneamente, sem perda de dado (todo valor de 2
-- casas já cabe exatamente em 4 casas) e sem reescrever a tabela inteira
-- (ALTER COLUMN TYPE entre precisões numeric é metadata-only quando só
-- amplia a escala). Não muda NENHUM valor já gravado, só o que cabe daqui
-- pra frente. 4 casas é o mesmo padrão que OrcamentoItem.
-- precoSugeridoUnitario e o módulo de Compras já usam, e é o teto que a
-- própria NF-e aceita no valor unitário (src/lib/focus-nfe.ts já grava com
-- .toFixed(4)).
--
-- Ficam de propósito em 2 casas (fronteira legítima de dinheiro real, não
-- bug): Pedido.precoSugeridoTotal/valorNegociadoTotal/custoPrevistoTotal,
-- Comissao.valorBase/valorComissao, ContaReceber.valor — nenhuma dessas
-- tabelas é tocada aqui.

-- AlterTable
ALTER TABLE "itens_grafica" ALTER COLUMN "precoVenda" TYPE DECIMAL(12,4);

-- AlterTable
ALTER TABLE "orcamentos" ALTER COLUMN "total" TYPE DECIMAL(12,4);

-- AlterTable
ALTER TABLE "orcamento_opcoes" ALTER COLUMN "total" TYPE DECIMAL(12,4);

-- AlterTable
ALTER TABLE "orcamento_itens" ALTER COLUMN "precoUnitario" TYPE DECIMAL(12,4);
ALTER TABLE "orcamento_itens" ALTER COLUMN "precoTotal" TYPE DECIMAL(12,4);

-- AlterTable
ALTER TABLE "orcamento_item_faixas_quantidade" ALTER COLUMN "precoUnitario" TYPE DECIMAL(12,4);
ALTER TABLE "orcamento_item_faixas_quantidade" ALTER COLUMN "precoTotal" TYPE DECIMAL(12,4);
