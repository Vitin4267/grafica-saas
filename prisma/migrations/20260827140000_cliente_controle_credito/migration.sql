-- Achado A6 da Parte 4 da auditoria de abrangencia (2026-08-27): controle de
-- credito do cliente. Puramente aditivo — todas as colunas novas sao
-- nullable ou tem default que preserva o comportamento de hoje.

ALTER TABLE "clientes"
  ADD COLUMN "limiteCredito" DECIMAL(12,2),
  ADD COLUMN "prazoPagamentoPadraoDias" INTEGER,
  ADD COLUMN "bloqueadoParaFaturamento" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "motivoBloqueioFaturamento" TEXT;

ALTER TABLE "parametros_grafica"
  ADD COLUMN "bloqueiaAoUltrapassarLimiteCredito" BOOLEAN NOT NULL DEFAULT false;
