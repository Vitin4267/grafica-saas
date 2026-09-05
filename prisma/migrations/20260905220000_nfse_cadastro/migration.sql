-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado F2 da auditoria de abrangência (Parte 7, "Sistema só emite NF-e de
-- mercadoria; gráfica que fatura serviço não tem onde cadastrar"). Súmula
-- 156/STJ + LC 116/2003 item 13.05 (composição gráfica) e 24.01 (sinalização
-- visual) tratam personalização/estamparia/impressão sobre material do
-- cliente como industrialização/serviço (ISS), não mercadoria (ICMS).
--
-- Escopo desta rodada: SÓ CADASTRO. Nenhuma emissão de NFS-e de verdade é
-- implementada aqui (isso é fase 2) — só o terreno de dados.
--
-- 100% aditivo/compatível, em 3 partes:
--
-- 1) Colunas NULLABLE novas em "itens_catalogo" (código de serviço da LC
--    116 e do município), "dados_fiscais_grafica" e "dados_fiscais_filial"
--    (inscrição municipal, código IBGE do município, alíquota de ISS do
--    EMITENTE — Cliente.inscricaoMunicipal, do TOMADOR, já existia desde
--    20260827130000). Nenhuma linha existente muda de comportamento; nada é
--    obrigatório, nem mesmo pra ItemCatalogo.tipo=SERVICO.
--
-- 2) Enum novo "ModeloDocumentoFiscal" (NFE/NFSE/NFCE) + coluna
--    "notas_fiscais"."modelo" NOT NULL DEFAULT 'NFE' — toda nota já
--    existente (e toda nova sem o campo setado) continua sendo tratada como
--    NF-e, exatamente o comportamento de sempre.
--
-- 3) Relaxa a constraint única de "notas_fiscais"."orcamentoId": antes era
--    UNIQUE sozinho (1 nota por orçamento, sempre NF-e implícita); agora
--    composta com "modelo" (1 nota por MODELO por orçamento) — permite uma
--    venda mista emitir tanto NFE quanto NFSE pro mesmo orçamento, sem
--    permitir duas notas do MESMO modelo (continua impedindo o caso que a
--    constraint original impedia). Verificado antes de escrever esta
--    migration, via query read-only contra o banco de dev (não persistida
--    em código): `SELECT "orcamentoId", COUNT(*) FROM "notas_fiscais" GROUP
--    BY "orcamentoId" HAVING COUNT(*) > 1` retornou 0 linhas (banco de dev
--    tem 0 notas fiscais hoje) — não há dado nenhum que viole a constraint
--    nova, e ela é estritamente MENOS restritiva que a antiga (todo dado que
--    satisfazia a UNIQUE simples também satisfaz a composta).

-- CreateEnum
CREATE TYPE "ModeloDocumentoFiscal" AS ENUM ('NFE', 'NFSE', 'NFCE');

-- AlterTable: ItemCatalogo — código de serviço (só relevante quando tipo=SERVICO)
ALTER TABLE "itens_catalogo" ADD COLUMN     "itemListaServicoLc116" TEXT,
ADD COLUMN     "codigoServicoMunicipal" TEXT;

-- AlterTable: DadosFiscaisGrafica — dados do emitente pra NFS-e
ALTER TABLE "dados_fiscais_grafica" ADD COLUMN     "inscricaoMunicipal" TEXT,
ADD COLUMN     "codigoMunicipioIbge" TEXT,
ADD COLUMN     "aliquotaIssPercent" DECIMAL(5,2);

-- AlterTable: DadosFiscaisFilial — espelha DadosFiscaisGrafica campo a campo
ALTER TABLE "dados_fiscais_filial" ADD COLUMN     "inscricaoMunicipal" TEXT,
ADD COLUMN     "codigoMunicipioIbge" TEXT,
ADD COLUMN     "aliquotaIssPercent" DECIMAL(5,2);

-- AlterTable: NotaFiscal — novo campo `modelo`, default NFE preserva 100%
-- do comportamento de toda nota já existente e de todo emissor atual (só
-- emite NF-e).
ALTER TABLE "notas_fiscais" ADD COLUMN     "modelo" "ModeloDocumentoFiscal" NOT NULL DEFAULT 'NFE';

-- DropIndex: constraint única simples de orcamentoId (1 nota por orçamento)
DROP INDEX "notas_fiscais_orcamentoId_key";

-- CreateIndex: constraint única composta (1 nota por MODELO por orçamento)
-- — estritamente menos restritiva, ver nota acima.
CREATE UNIQUE INDEX "notas_fiscais_orcamentoId_modelo_key" ON "notas_fiscais"("orcamentoId", "modelo");
