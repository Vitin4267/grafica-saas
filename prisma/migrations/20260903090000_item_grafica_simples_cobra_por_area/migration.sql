-- Achado N1 da auditoria de abrangência (Parte 7): ItemGrafica.simplesCobraPorArea
-- decide, no PRODUTO (não mais na linha do orçamento), se um item
-- modeloCalculo=SIMPLES cobra por m² (largura×altura) ou por peça.

-- Passo 1: nova coluna, default false — preserva "cobra por peça" (o
-- comportamento de hoje) para todo produto por padrão.
ALTER TABLE "itens_grafica" ADD COLUMN "simplesCobraPorArea" BOOLEAN NOT NULL DEFAULT false;

-- Passo 2: backfill — liga a flag em todo ItemGrafica que JÁ FOI usado, no
-- passado, como "cobra por área" (algum OrcamentoItem SIMPLES com largura E
-- altura preenchidas). Preserva o comportamento observado hoje pra quem já
-- dependia disso (ex: rótulos por tamanho), sem exigir saber quem é —
-- qualquer gráfica na mesma situação é coberta, não só um cliente específico.
UPDATE "itens_grafica"
SET "simplesCobraPorArea" = true
WHERE id IN (
  SELECT DISTINCT oi."itemGraficaId"
  FROM "orcamento_itens" oi
  WHERE oi."modeloCalculo" = 'SIMPLES'
    AND oi."larguraCm" IS NOT NULL
    AND oi."alturaCm" IS NOT NULL
);
