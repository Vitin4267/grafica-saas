-- Migração escrita à mão (drift do Prisma por causa da tabela n8n_chatbot,
-- fora do controle de migrations — NÃO rodar `prisma migrate reset`).
--
-- Achado B6 da auditoria de abrangência (pesquisa-abrangencia-modulos.md) —
-- "Linha de orçamento sempre tem que ser um item do catálogo, e não tem
-- descrição própria". Escopo deliberadamente contido: só um campo de texto
-- livre que sobrepõe o nome do catálogo no PDF/link público quando
-- preenchido (ver src/lib/pdf/mapear-dados.ts e src/app/o/[token]/page.tsx).
-- Não remove a obrigatoriedade de OrcamentoItem.itemGraficaId — a parte
-- opcional do achado (permitir item sem catálogo, com nome+preço digitados)
-- fica de fora de propósito, é escopo maior.
--
-- Adiciona OrcamentoItem.descricaoLivre — nullable, aditivo. Todo item já
-- existente continua mostrando o nome genérico do catálogo, comportamento de
-- sempre.

-- AlterTable
ALTER TABLE "orcamento_itens" ADD COLUMN "descricaoLivre" TEXT;
