-- Achado da auditoria de segurança (2026-09-13) — parte 2 da migration de
-- criptografia (ver 20260913100000_cripto_credenciais_add_colunas). SÓ
-- rodar depois que o script de backfill confirmou que TODA linha com valor
-- antigo em texto claro tem o equivalente cifrado gravado na coluna nova —
-- esta migration é destrutiva (dropa a coluna em texto claro pra sempre).

-- dados_fiscais_grafica / dados_fiscais_filial: focusNfeToken texto claro sai.
ALTER TABLE "dados_fiscais_grafica" DROP COLUMN "focusNfeToken";
ALTER TABLE "dados_fiscais_filial" DROP COLUMN "focusNfeToken";

-- automacao_grafica: webhookUrl texto claro sai.
ALTER TABLE "automacao_grafica" DROP COLUMN "webhookUrl";

-- orcamentos: linkPublicoToken texto claro sai; índice único migra pro hash.
DROP INDEX "orcamentos_linkPublicoToken_key";
ALTER TABLE "orcamentos" DROP COLUMN "linkPublicoToken";
CREATE UNIQUE INDEX "orcamentos_linkPublicoTokenHash_key" ON "orcamentos"("linkPublicoTokenHash");

-- pedidos: os 3 tokens em texto claro saem; índices únicos migram pro hash.
DROP INDEX "pedidos_arteLinkToken_key";
ALTER TABLE "pedidos" DROP COLUMN "arteLinkToken";
CREATE UNIQUE INDEX "pedidos_arteLinkTokenHash_key" ON "pedidos"("arteLinkTokenHash");

DROP INDEX "pedidos_producaoLinkToken_key";
ALTER TABLE "pedidos" DROP COLUMN "producaoLinkToken";
CREATE UNIQUE INDEX "pedidos_producaoLinkTokenHash_key" ON "pedidos"("producaoLinkTokenHash");

DROP INDEX "pedidos_qrToken_key";
ALTER TABLE "pedidos" DROP COLUMN "qrToken";
CREATE UNIQUE INDEX "pedidos_qrTokenHash_key" ON "pedidos"("qrTokenHash");
