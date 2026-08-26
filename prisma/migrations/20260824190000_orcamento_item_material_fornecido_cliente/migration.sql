-- Migração escrita à mão (drift do Prisma por causa da tabela n8n_chatbot,
-- fora do controle de migrations — NÃO rodar `prisma migrate reset`).
--
-- Achado B7 da auditoria de abrangência (pesquisa-abrangencia-modulos.md) —
-- CORREÇÃO DE REGRESSÃO introduzida pelo próprio achado A2 (2026-08-24):
-- nenhum campo distinguia "a gráfica fornece a camiseta/caneca/boné" de "o
-- cliente traz o produto em branco, a gráfica só aplica a estampa/gravação".
-- Isso já era um gap antes, mas depois que A2 passou a cobrar
-- ContextoDigital/ContextoSetupPorPeca.custoSubstratoPorPeca (motores
-- DIGITAL/SERIGRAFIA/SUBLIMACAO/ESTAMPAGEM_QUENTE/PERSONALIZACAO), toda
-- gráfica de estamparia que trabalha com "cliente traz a peça" passou a ser
-- cobrada pelo custo de uma peça que ela nunca comprou.
--
-- Adiciona OrcamentoItem.materialFornecidoPeloCliente — quando true, o motor
-- zera o substrato pra este item (ver src/lib/orcamento-precificacao.ts).
-- NOT NULL DEFAULT false preserva 100% o comportamento de todo item já
-- existente (continua cobrando o substrato normalmente).

-- AlterTable
ALTER TABLE "orcamento_itens" ADD COLUMN "materialFornecidoPeloCliente" BOOLEAN NOT NULL DEFAULT false;
