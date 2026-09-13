-- Achado da auditoria de segurança (2026-09-13) — cifra credenciais
-- (focusNfeToken, webhookUrl) e hash+cifra dos 4 tokens de link público
-- (ver src/lib/cripto.ts, src/lib/tenant-context.ts, comentários dos campos
-- no schema). Migration ADITIVA só — as colunas antigas em texto claro
-- continuam existindo aqui, cheias, até o script de backfill (fora desta
-- migration, roda em Node porque cifrar exige a lib de criptografia) gravar
-- os valores cifrados nas colunas novas. Só depois disso a migration
-- seguinte (20260913100001_cripto_credenciais_remove_colunas_antigas) dropa
-- as colunas antigas — NÃO rodar aquela migration antes do backfill.

ALTER TABLE "dados_fiscais_grafica" ADD COLUMN "focusNfeTokenCifrado" TEXT;
ALTER TABLE "dados_fiscais_grafica" ADD COLUMN "focusNfeTokenUltimos4" TEXT;

ALTER TABLE "dados_fiscais_filial" ADD COLUMN "focusNfeTokenCifrado" TEXT;
ALTER TABLE "dados_fiscais_filial" ADD COLUMN "focusNfeTokenUltimos4" TEXT;

ALTER TABLE "automacao_grafica" ADD COLUMN "webhookUrlCifrado" TEXT;

ALTER TABLE "orcamentos" ADD COLUMN "linkPublicoTokenHash" TEXT;
ALTER TABLE "orcamentos" ADD COLUMN "linkPublicoTokenCifrado" TEXT;

ALTER TABLE "pedidos" ADD COLUMN "arteLinkTokenHash" TEXT;
ALTER TABLE "pedidos" ADD COLUMN "arteLinkTokenCifrado" TEXT;
ALTER TABLE "pedidos" ADD COLUMN "producaoLinkTokenHash" TEXT;
ALTER TABLE "pedidos" ADD COLUMN "producaoLinkTokenCifrado" TEXT;
ALTER TABLE "pedidos" ADD COLUMN "qrTokenHash" TEXT;
ALTER TABLE "pedidos" ADD COLUMN "qrTokenCifrado" TEXT;
