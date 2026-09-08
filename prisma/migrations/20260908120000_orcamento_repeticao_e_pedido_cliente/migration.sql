-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado novo (não numerado na auditoria de abrangência — pedido direto do
-- dono depois de comparar o sistema com um "Pedido Interno" real em papel
-- da Assus Graphics, cliente-piloto, 2026-09-08). O formulário de papel tem
-- 2 campos que o GrafPro não capturava:
--
-- 1. Checkbox "Modelo Novo / Repetição s/ alteração / Repetição c/
--    alteração" — POR ITEM do orçamento (o sistema já tinha esse mesmo
--    conceito no CABEÇALHO desde sempre, Orcamento.tipoPedido/enum
--    TipoPedidoOrcamento, criado na migração 20260812223651_orcamento_completo
--    — este achado é sobre granularidade por item, não sobre inventar o
--    conceito). Reaproveita o enum TipoPedidoOrcamento já existente (mesmas
--    3 opções, mesmo significado) em vez de criar um enum duplicado.
-- 2. Número que o CLIENTE usa pra rastrear a própria compra (independente
--    do id/número do GrafPro) — não existia nenhum campo pra isso.
--
-- Adiciona:
-- - coluna "tipoRepeticao" (enum TipoPedidoOrcamento, opcional) em
--   "orcamento_itens".
-- - coluna "numeroPedidoCliente" (texto livre, opcional) em "orcamentos".
--
-- Migração 100% aditiva: as duas colunas nascem NULL em todo item/orçamento
-- já existente (comportamento de hoje 100% preservado) e nenhuma é lida por
-- src/lib/pricing/ nem src/lib/orcamento-precificacao.ts — puramente
-- informativo/produção, mesmo caráter de OrcamentoItem.ferramentalId
-- (achado F1) e OrcamentoItem.descricaoLivre (achado B6).

-- AlterTable
ALTER TABLE "orcamento_itens" ADD COLUMN "tipoRepeticao" "TipoPedidoOrcamento";

-- AlterTable
ALTER TABLE "orcamentos" ADD COLUMN "numeroPedidoCliente" TEXT;
