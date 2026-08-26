-- Migração escrita à mão (drift do Prisma por causa da tabela n8n_chatbot,
-- fora do controle de migrations — NÃO rodar `prisma migrate reset`).
--
-- Achado A11 da auditoria de abrangência (pesquisa-abrangencia-modulos.md):
-- até aqui Cliente era o único model do domínio comercial sem nenhum campo
-- de texto livre (Orcamento/Pedido/Entrega/Despesa já têm) e sem forma de
-- registrar de onde o cliente veio.
--
-- Adiciona:
-- - clientes.observacoes: nota interna, nunca exposta em PDF nem no link
--   público de orçamento (mesma regra de Orcamento.observacoes).
-- - clientes.preferenciasProducao: separado de propósito — é o que precisa
--   chegar até a Ordem de Produção (ver
--   src/app/producao/[pedidoId]/ordem-producao/route.tsx), diferente de uma
--   nota comercial interna.
-- - enum OrigemCliente + clientes.origem/origemOutro: canal de aquisição,
--   mesmo padrão enum-fechado+OUTRO do resto do schema.
--
-- Todas as colunas são aditivas e nascem NULL — não quebram nenhum tenant
-- existente.

-- CreateEnum
CREATE TYPE "OrigemCliente" AS ENUM ('INDICACAO', 'REDES_SOCIAIS', 'BUSCA_GOOGLE', 'ANUNCIO', 'FEIRA_EVENTO', 'PROSPECCAO_ATIVA', 'CLIENTE_ANTIGO', 'OUTRO');

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "observacoes" TEXT,
ADD COLUMN     "preferenciasProducao" TEXT,
ADD COLUMN     "origem" "OrigemCliente",
ADD COLUMN     "origemOutro" TEXT;
