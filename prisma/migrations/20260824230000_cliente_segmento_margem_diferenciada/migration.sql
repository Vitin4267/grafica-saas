-- Migração escrita à mão (drift do Prisma por causa da tabela n8n_chatbot,
-- fora do controle de migrations — NÃO rodar `prisma migrate reset`).
--
-- Achado A7 da auditoria de abrangência (pesquisa-abrangencia-modulos.md),
-- "Nível 1": não existia segmento de cliente nem forma de dar margem
-- diferenciada pra revenda/agência — todo cliente era precificado com a
-- mesma ParametrosGrafica.margemPadrao. O motor de precificação já tinha o
-- gancho pronto e dormente (ContextoPrecificacao.margemLucroOverride, ver
-- src/lib/pricing/precificar.ts/compor.ts) — esta migração só adiciona o
-- cadastro que alimenta esse gancho (ver src/lib/orcamento-precificacao.ts).
--
-- Adiciona:
-- - enum SegmentoCliente + clientes.segmento/segmentoOutro: mesmo padrão
--   enum-fechado+OUTRO de OrigemCliente (migração
--   20260824160000_cliente_observacoes_preferencias_origem).
-- - clientes.margemPadraoOverride: fração 0-1 (ex: 0.15 = 15%, nunca 0-100),
--   mesma representação e precisão de ParametrosGrafica.margemPadrao
--   (Decimal(5,4)). NULL = motor usa o padrão da gráfica — comportamento de
--   hoje, sem regressão pra nenhum cliente existente.
--
-- "Nível 2" da proposta do achado (model TabelaPreco, tabela de preço por
-- item/categoria por segmento) fica de fora de propósito — registrado só
-- como ideia futura no próprio achado.
--
-- Todas as colunas são aditivas e nascem NULL — não quebram nenhum tenant
-- existente.

-- CreateEnum
CREATE TYPE "SegmentoCliente" AS ENUM ('VAREJO', 'EMPRESA', 'REVENDA_AGENCIA', 'INDUSTRIA', 'ORGAO_PUBLICO', 'OUTRO');

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "segmento" "SegmentoCliente",
ADD COLUMN     "segmentoOutro" TEXT,
ADD COLUMN     "margemPadraoOverride" DECIMAL(5,4);
