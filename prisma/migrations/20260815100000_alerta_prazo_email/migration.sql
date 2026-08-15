-- Alerta de prazo por e-mail (5/3/0 dias) — coluna nova, opcional, nenhuma
-- mudança de comportamento até o cron ler/escrever nela.
-- NOTA: o diff automático também sugeriu DROP TABLE "n8n_chatbot" — mesmo
-- drift pré-existente (fora do Prisma) já identificado na migration
-- 20260814200000_fase_custo_real_schema. Removido de propósito, não mexer.

-- AlterTable
ALTER TABLE "pedidos" ADD COLUMN     "alertaPrazoUltimoLimiarDias" INTEGER;
