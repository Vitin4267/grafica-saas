-- Achado B4 da auditoria de abrangência — prazo estimado de entrega POR ITEM
-- (complementa Orcamento.prazoEntregaEstimadoDias único no cabeçalho).
-- Quando preenchido, o cabeçalho reflete automaticamente o MÁXIMO entre os itens.
-- Aditivo, nullable — todo item criado antes desta migration tem prazo null.
ALTER TABLE "orcamento_itens" ADD COLUMN "prazoEstimadoDias" INTEGER;
