-- Expande StatusPedido de 5 pros 8 estágios da visão de produto de longo
-- prazo (Arte → Clichê/Faca → Produção → Acabamento → Conferência →
-- Embalagem → Expedição → Entregue), mais CANCELADO.
--
-- Usa RENAME VALUE (não recria o enum do zero) pros 3 estágios que já
-- existiam e têm equivalente direto no fluxo novo — isso preserva o dado de
-- TODO pedido já em produção automaticamente, sem UPDATE nenhum e sem
-- nenhuma janela em que um pedido fique com um status inválido:
--   FILA      -> ARTE       (estágio inicial, onde já vivia o gate de
--                             aprovação de arte antes de avançar)
--   IMPRESSAO -> PRODUCAO   (produção física em si)
--   PRONTO    -> EXPEDICAO  (estágio final antes de Entregue — era o
--                             "pronto pra sair", que no fluxo novo virou
--                             "aguardando expedição")
-- ACABAMENTO e ENTREGUE mantêm o mesmo nome (significado idêntico).
--
-- CLICHE_FACA, CONFERENCIA e EMBALAGEM são estágios totalmente novos, sem
-- pedido nenhum neles ainda — ADD VALUE só declara o rótulo válido pra
-- pedidos que passarem por ali dali em diante.
ALTER TYPE "StatusPedido" RENAME VALUE 'FILA' TO 'ARTE';
ALTER TYPE "StatusPedido" RENAME VALUE 'IMPRESSAO' TO 'PRODUCAO';
ALTER TYPE "StatusPedido" RENAME VALUE 'PRONTO' TO 'EXPEDICAO';

ALTER TYPE "StatusPedido" ADD VALUE 'CLICHE_FACA' AFTER 'ARTE';
ALTER TYPE "StatusPedido" ADD VALUE 'CONFERENCIA' AFTER 'ACABAMENTO';
ALTER TYPE "StatusPedido" ADD VALUE 'EMBALAGEM' AFTER 'CONFERENCIA';

-- Pedido.status @default(ARTE) — era @default(FILA); o rótulo 'ARTE' já
-- existe neste ponto (renomeado acima), então isto é seguro dentro da mesma
-- transação da migration.
ALTER TABLE "pedidos" ALTER COLUMN "status" SET DEFAULT 'ARTE';
