-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Pedido direto do dono (2026-09-08, não é achado da auditoria de
-- abrangência): estoque de produto PRÉ-PRODUZIDO — a gráfica pode fabricar
-- um PRODUTO especulativamente (ex: 5.000 cartões de visita padrão) ANTES
-- de qualquer pedido existir, consumindo matéria-prima na hora e guardando
-- como "produto pronto em estoque"; quando um pedido de fato chegar pra
-- esse mesmo produto, pode ser atendido do estoque pronto em vez de rodar
-- produção do zero. Reaproveita o MESMO campo ItemGrafica.estoqueAtual (já
-- existente, hoje inerte pra tipo=PRODUTO) e a MESMA tabela
-- MovimentacaoEstoque (ledger) — nenhuma tabela nova.
--
-- Adiciona:
-- - enum "TipoMovimentacao": ENTRADA_PRODUCAO (produto fabricado
--   especulativamente) e SAIDA_ATENDIMENTO_PEDIDO (produto pré-produzido
--   consumido por um pedido real, sem rodar produção).
-- - enum "OrigemCusto": PRODUTO_PRE_PRODUZIDO (CustoPedido gerado quando um
--   pedido é atendido do estoque pronto).
--
-- Migração 100% aditiva: só acrescenta valores a enums já existentes —
-- nenhuma tabela, coluna, tipo ou obrigatoriedade muda. Nenhuma linha
-- existente é reescrita. Ver src/lib/pre-producao-estoque.ts e o branch
-- condicional em avancarStatusPedido (src/app/producao/status-transicao.ts)
-- pra onde estes valores passam a ser gravados.

-- AlterEnum
ALTER TYPE "TipoMovimentacao" ADD VALUE 'ENTRADA_PRODUCAO';
ALTER TYPE "TipoMovimentacao" ADD VALUE 'SAIDA_ATENDIMENTO_PEDIDO';

-- AlterEnum
ALTER TYPE "OrigemCusto" ADD VALUE 'PRODUTO_PRE_PRODUZIDO';
