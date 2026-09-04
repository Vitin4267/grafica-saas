-- Achado N6 da auditoria de abrangência (Parte 7, 2026-09-03):
-- mapearItemNfePayload (src/lib/focus-nfe.ts) mandava icms_origem: "0"
-- (nacional) fixo pra todo item de NF-e, de toda gráfica, sem nenhum campo
-- de origem no catálogo. Gráfica de brindes/comunicação visual/DTF que
-- revende mercadoria importada emitia nota fiscal declarando origem
-- nacional errada. Coluna nova, NOT NULL com DEFAULT 'NACIONAL_0' — mesmo
-- comportamento de hoje pra todo item já cadastrado, sem backfill especial
-- necessário (0 gráficas com Focus NFe configurado, 0 notas fiscais
-- emitidas hoje).

-- CreateEnum
CREATE TYPE "OrigemMercadoria" AS ENUM ('NACIONAL_0', 'ESTRANGEIRA_IMPORTACAO_DIRETA_1', 'ESTRANGEIRA_MERCADO_INTERNO_2', 'NACIONAL_CONTEUDO_IMPORTACAO_40_A_70_3', 'NACIONAL_PROCESSO_PRODUTIVO_BASICO_4', 'NACIONAL_CONTEUDO_IMPORTACAO_ATE_40_5', 'ESTRANGEIRA_IMPORTACAO_DIRETA_SEM_SIMILAR_6', 'ESTRANGEIRA_MERCADO_INTERNO_SEM_SIMILAR_7', 'NACIONAL_CONTEUDO_IMPORTACAO_ACIMA_70_8');

-- AlterTable
ALTER TABLE "itens_catalogo" ADD COLUMN "origemMercadoria" "OrigemMercadoria" NOT NULL DEFAULT 'NACIONAL_0';
