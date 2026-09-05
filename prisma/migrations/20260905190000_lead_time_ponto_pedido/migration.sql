-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A8 da Parte 3 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md, "Compras"): a sugestão de compra em
-- /compras (ver calcularPrevisaoEstoque em src/lib/previsao-estoque-db.ts)
-- tinha um limiar de "dias restantes" fixo em 30 no código (número mágico),
-- e não existia lead time em lugar nenhum do sistema — sem lead time, a
-- fórmula real de ponto de pedido (estoque de segurança + consumo médio
-- diário × lead time) não podia ser calculada.
--
-- 100% aditiva: 2 colunas novas em "parametros_grafica" com DEFAULT (nenhuma
-- linha existente muda de comportamento) + 1 coluna nullable em
-- "itens_grafica" (null = usa o padrão da gráfica).
--
-- "itens_grafica"."leadTimeDias" foi escolhido em vez de
-- "fornecedores"."prazoEntregaMedioDias" pra este ponto de pedido: a
-- sugestão de compra roda ANTES de qualquer fornecedor ser escolhido pra
-- aquela reposição (SolicitacaoCompra.fornecedorId só costuma ser
-- preenchido a partir de APROVADO) e ItemGrafica não tem fornecedor
-- preferencial cadastrado hoje — ver comentário completo no schema
-- (06-catalogo.prisma, campo leadTimeDias).

-- AlterTable
ALTER TABLE "parametros_grafica" ADD COLUMN     "diasAlertaCompraPadrao" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "leadTimePadraoDias" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "itens_grafica" ADD COLUMN     "leadTimeDias" INTEGER;
