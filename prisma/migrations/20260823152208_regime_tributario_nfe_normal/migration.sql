-- Migração escrita à mão (NÃO deixar o Prisma regenerar) — regimeTributario
-- era texto livre ("Simples Nacional", "Lucro Presumido", vazio, etc.) e
-- vira um enum fechado. Um cast direto ::RegimeTributario quebraria em
-- qualquer linha cujo texto não bata exatamente com um valor do enum, então
-- o caminho aqui é: criar o enum -> adicionar coluna nova (nullable) ->
-- backfill via CASE/ILIKE -> SET NOT NULL + DEFAULT -> DROP da coluna antiga
-- -> RENAME. Fallback SIMPLES_NACIONAL pra qualquer texto que não reconheça
-- (vazio, nulo, lixo) — consistente com o default atual de csosnPadrao
-- ("102") já assumir Simples Nacional.

-- CreateEnum
CREATE TYPE "RegimeTributario" AS ENUM ('SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL');

-- ===== dados_fiscais_grafica =====

-- AlterTable: campos novos, nullable, sem risco de perda de dado
ALTER TABLE "dados_fiscais_grafica"
  ADD COLUMN "cstIcmsPadrao" TEXT,
  ADD COLUMN "icmsAliquotaPadrao" DECIMAL(5,2),
  ADD COLUMN "icmsModalidadeBaseCalculoPadrao" TEXT,
  ADD COLUMN "pisCofinsSituacaoTributariaPadrao" TEXT;

-- Coluna nova (nullable por enquanto) pra receber o backfill sem tocar na antiga
ALTER TABLE "dados_fiscais_grafica" ADD COLUMN "regimeTributarioNovo" "RegimeTributario";

UPDATE "dados_fiscais_grafica"
SET "regimeTributarioNovo" = CASE
  WHEN "regimeTributario" ILIKE '%simples%' THEN 'SIMPLES_NACIONAL'::"RegimeTributario"
  WHEN "regimeTributario" ILIKE '%presumido%' THEN 'LUCRO_PRESUMIDO'::"RegimeTributario"
  WHEN "regimeTributario" ILIKE '%real%' THEN 'LUCRO_REAL'::"RegimeTributario"
  ELSE 'SIMPLES_NACIONAL'::"RegimeTributario"
END;

ALTER TABLE "dados_fiscais_grafica" ALTER COLUMN "regimeTributarioNovo" SET NOT NULL;
ALTER TABLE "dados_fiscais_grafica" ALTER COLUMN "regimeTributarioNovo" SET DEFAULT 'SIMPLES_NACIONAL';

ALTER TABLE "dados_fiscais_grafica" DROP COLUMN "regimeTributario";
ALTER TABLE "dados_fiscais_grafica" RENAME COLUMN "regimeTributarioNovo" TO "regimeTributario";

-- ===== dados_fiscais_filial =====

ALTER TABLE "dados_fiscais_filial"
  ADD COLUMN "cstIcmsPadrao" TEXT,
  ADD COLUMN "icmsAliquotaPadrao" DECIMAL(5,2),
  ADD COLUMN "icmsModalidadeBaseCalculoPadrao" TEXT,
  ADD COLUMN "pisCofinsSituacaoTributariaPadrao" TEXT;

ALTER TABLE "dados_fiscais_filial" ADD COLUMN "regimeTributarioNovo" "RegimeTributario";

UPDATE "dados_fiscais_filial"
SET "regimeTributarioNovo" = CASE
  WHEN "regimeTributario" ILIKE '%simples%' THEN 'SIMPLES_NACIONAL'::"RegimeTributario"
  WHEN "regimeTributario" ILIKE '%presumido%' THEN 'LUCRO_PRESUMIDO'::"RegimeTributario"
  WHEN "regimeTributario" ILIKE '%real%' THEN 'LUCRO_REAL'::"RegimeTributario"
  ELSE 'SIMPLES_NACIONAL'::"RegimeTributario"
END;

ALTER TABLE "dados_fiscais_filial" ALTER COLUMN "regimeTributarioNovo" SET NOT NULL;
ALTER TABLE "dados_fiscais_filial" ALTER COLUMN "regimeTributarioNovo" SET DEFAULT 'SIMPLES_NACIONAL';

ALTER TABLE "dados_fiscais_filial" DROP COLUMN "regimeTributario";
ALTER TABLE "dados_fiscais_filial" RENAME COLUMN "regimeTributarioNovo" TO "regimeTributario";
