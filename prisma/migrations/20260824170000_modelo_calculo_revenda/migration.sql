-- Migração escrita à mão (drift do Prisma por causa da tabela n8n_chatbot,
-- fora do controle de migrations — NÃO rodar `prisma migrate reset`).
--
-- Achado A12 da auditoria de abrangência (pesquisa-abrangencia-modulos.md):
-- ModeloCalculo.SIMPLES era "preço digitado, zero custo calculado" — usado
-- tanto pra produto próprio simples quanto (na falta de alternativa) pra
-- revenda de brinde/terceirização. Problema: o preço não era DERIVADO de
-- custo (nunca passava por comporPreco, então não ganhava overhead/imposto/
-- margem/piso automaticamente) e não gerava breakdown auditável. O setor de
-- brindes é "produto comprado + gravação aplicada" — modelo de negócio
-- inteiro que entrava no sistema sem custo real.
--
-- Adiciona ModeloCalculo.REVENDA (10º rótulo) — custoBase = Q ×
-- custoAquisicaoUnitario, sem máquina, sem setup, mas passando pelo MESMO
-- comporPreco de todo mundo — e OrcamentoItem.custoAquisicaoUnitario, um
-- override opcional POR ORÇAMENTO do custo de aquisição (o preço de brinde
-- de fornecedor muda por cotação/faixa de quantidade a cada orçamento);
-- quando não preenchido, o motor cai no ItemGrafica.precoCompra do catálogo
-- (mesmo fallback que ContextoDigital/ContextoSetupPorPeca já usam a partir
-- de precoCompra).
--
-- Ambas as operações são aditivas (ADD VALUE / ADD COLUMN nullable) e não
-- quebram nenhum tenant existente: nenhum valor de enum existente muda de
-- nome, e a coluna nova é opcional.

-- AlterEnum
ALTER TYPE "ModeloCalculo" ADD VALUE 'REVENDA';

-- AlterTable
ALTER TABLE "orcamento_itens" ADD COLUMN     "custoAquisicaoUnitario" DECIMAL(12,4);
