-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A9 da auditoria de abrangência (Parte 3/Compras, 2026-08-30):
-- nada representava um acordo de fornecimento contínuo com preço fixo por
-- período — ItemGrafica.precoCompra e TabelaPrecoPapel.precoKg são preços
-- de REFERÊNCIA, sem vigência nem fornecedor associado. Dá função de
-- verdade a OrigemSolicitacaoCompra.CONTRATO_PROGRAMADO (enum já existia
-- desde a migração 20260829100000_origem_solicitacao_compra, sem nenhum
-- comportamento associado até agora).
--
-- Adiciona:
-- - tabela "contratos_fornecimento": contrato de fornecimento com preço
--   fixo por período (fornecedorId obrigatório; itemGraficaId/varianteId
--   opcionais — contrato "coringa" cobre qualquer matéria-prima do
--   fornecedor). Reusa o enum "UnidadeCompra" (achado A6 da mesma auditoria,
--   migração 20260830150000_unidade_compra) só como rótulo informativo de
--   como o preço foi negociado — precoUnitario é sempre por unidade de
--   ESTOQUE, sem fator de conversão próprio (ver comentário do model no
--   schema).
-- - coluna "contratoFornecimentoId" em "solicitacoes_compra": qual contrato
--   autorizou a solicitação a nascer direto em APROVADO quando
--   origem=CONTRATO_PROGRAMADO (ver avancarStatusCompra/
--   criarSolicitacaoCompra em src/app/compras/).
--
-- Migração 100% aditiva: nenhuma tabela/coluna existente muda de
-- tipo/obrigatoriedade, nenhum dado é reescrito. Solicitações de compra já
-- existentes ficam com contratoFornecimentoId=NULL (comportamento de hoje
-- 100% preservado).

-- CreateTable
CREATE TABLE "contratos_fornecimento" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "fornecedorId" TEXT NOT NULL,
    "itemGraficaId" TEXT,
    "varianteId" TEXT,
    "precoUnitario" DECIMAL(12,4) NOT NULL,
    "unidadeCompra" "UnidadeCompra" NOT NULL,
    "unidadeCompraOutro" TEXT,
    "vigenciaInicio" DATE NOT NULL,
    "vigenciaFim" DATE NOT NULL,
    "quantidadeContratada" DECIMAL(12,4),
    "quantidadeConsumida" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "condicaoPagamento" TEXT,
    "observacao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contratos_fornecimento_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "solicitacoes_compra" ADD COLUMN "contratoFornecimentoId" TEXT;

-- CreateIndex
CREATE INDEX "contratos_fornecimento_graficaId_ativo_idx" ON "contratos_fornecimento"("graficaId", "ativo");

-- CreateIndex
CREATE INDEX "contratos_fornecimento_fornecedorId_idx" ON "contratos_fornecimento"("fornecedorId");

-- CreateIndex
CREATE INDEX "contratos_fornecimento_itemGraficaId_idx" ON "contratos_fornecimento"("itemGraficaId");

-- CreateIndex
CREATE INDEX "contratos_fornecimento_varianteId_idx" ON "contratos_fornecimento"("varianteId");

-- CreateIndex
CREATE INDEX "solicitacoes_compra_contratoFornecimentoId_idx" ON "solicitacoes_compra"("contratoFornecimentoId");

-- AddForeignKey
ALTER TABLE "contratos_fornecimento" ADD CONSTRAINT "contratos_fornecimento_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratos_fornecimento" ADD CONSTRAINT "contratos_fornecimento_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "fornecedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratos_fornecimento" ADD CONSTRAINT "contratos_fornecimento_itemGraficaId_fkey" FOREIGN KEY ("itemGraficaId") REFERENCES "itens_grafica"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratos_fornecimento" ADD CONSTRAINT "contratos_fornecimento_varianteId_fkey" FOREIGN KEY ("varianteId") REFERENCES "variantes_materia_prima"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_compra" ADD CONSTRAINT "solicitacoes_compra_contratoFornecimentoId_fkey" FOREIGN KEY ("contratoFornecimentoId") REFERENCES "contratos_fornecimento"("id") ON DELETE SET NULL ON UPDATE CASCADE;
