-- Achado A14 (Parte 4 — Financeiro) da auditoria de abrangência: despesa
-- recorrente só suportava periodicidade mensal, valor sempre igual e nunca
-- tinha fim. Aditivo puro — DEFAULT em todas as 3 colunas pra toda linha
-- existente (e toda série já criada) continuar se comportando exatamente
-- como antes, sem backfill.

-- CreateEnum
CREATE TYPE "PeriodicidadeDespesa" AS ENUM ('SEMANAL', 'QUINZENAL', 'MENSAL', 'BIMESTRAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL');

-- AlterTable
ALTER TABLE "despesas" ADD COLUMN     "periodicidade" "PeriodicidadeDespesa" NOT NULL DEFAULT 'MENSAL',
ADD COLUMN     "recorrenciaAteEm" DATE,
ADD COLUMN     "valorVariavel" BOOLEAN NOT NULL DEFAULT false;
