-- Achado A6 da Parte 5 da auditoria de abrangencia (2026-08-28): completa o
-- achado A6 da Parte 4 (limiteCredito/prazoPagamentoPadraoDias, ja
-- existentes) com forma de pagamento preferida, desconto padrao negociado e
-- uma nota financeira livre. Puramente aditivo — todas as colunas novas sao
-- nullable, sem mudanca de comportamento pra cadastro existente.
--
-- "FormaPagamento" ja existe como enum do Postgres (criado em
-- 20260710020049_estoque_pagamento, usado hoje em "pagamentos"."forma") —
-- so reaproveitado aqui, nenhum CREATE TYPE necessario.

ALTER TABLE "clientes"
  ADD COLUMN "formaPagamentoPreferida" "FormaPagamento",
  ADD COLUMN "descontoPadraoPercent" DECIMAL(5,4),
  ADD COLUMN "observacaoFinanceira" TEXT;
