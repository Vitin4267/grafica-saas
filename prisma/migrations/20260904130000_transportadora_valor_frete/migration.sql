-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado F3 da auditoria de abrangência (Parte 7/Documento e transação,
-- pesquisa-abrangencia-modulos.md): existia a MODALIDADE de frete
-- (Orcamento.frete, enum TipoFrete) mas não o VALOR, e a transportadora era
-- só texto livre (Orcamento.transportadora) sem CNPJ/RNTRC — a nota fiscal
-- saía sempre com valor_frete "0" fixo e sem grupo de transportadora.
--
-- Adiciona:
-- - tabela "transportadoras": cadastro formal (mesmo formato enxuto de
--   "fornecedores"), com RNTRC (Registro Nacional de Transportadores
--   Rodoviários de Cargas) específico de transportadora.
-- - colunas "transportadoraId"/"valorFrete" em "orcamentos": FK opcional +
--   valor, convivendo com o texto livre "transportadora" já existente
--   (mesmo padrão de "contatoClienteId"/"contatoNome" e
--   "enderecoEntregaId"/"localEntrega").
-- - colunas "transportadoraId"/"volumes"/"pesoBrutoKg"/"especieVolume" em
--   "entregas": dados de transporte físico, todos opcionais.
--
-- Migração 100% aditiva: nenhuma tabela/coluna existente muda de
-- tipo/obrigatoriedade, nenhum dado é reescrito. Todo orçamento/entrega já
-- existente fica com os campos novos NULL (comportamento de hoje 100%
-- preservado: NF-e continua mandando valor_frete "0" quando
-- Orcamento.valorFrete for null) e nenhuma gráfica tem nenhuma
-- Transportadora cadastrada até que alguém crie uma pela nova tela em
-- /configuracoes/transportadoras.

-- CreateTable
CREATE TABLE "transportadoras" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "documento" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "rntrc" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transportadoras_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "orcamentos"
    ADD COLUMN "transportadoraId" TEXT,
    ADD COLUMN "valorFrete" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "entregas"
    ADD COLUMN "transportadoraId" TEXT,
    ADD COLUMN "volumes" INTEGER,
    ADD COLUMN "pesoBrutoKg" DECIMAL(10,3),
    ADD COLUMN "especieVolume" TEXT;

-- CreateIndex
CREATE INDEX "transportadoras_graficaId_idx" ON "transportadoras"("graficaId");

-- CreateIndex
CREATE UNIQUE INDEX "transportadoras_graficaId_nome_key" ON "transportadoras"("graficaId", "nome");

-- CreateIndex
CREATE INDEX "orcamentos_transportadoraId_idx" ON "orcamentos"("transportadoraId");

-- CreateIndex
CREATE INDEX "entregas_transportadoraId_idx" ON "entregas"("transportadoraId");

-- AddForeignKey
ALTER TABLE "transportadoras" ADD CONSTRAINT "transportadoras_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_transportadoraId_fkey" FOREIGN KEY ("transportadoraId") REFERENCES "transportadoras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entregas" ADD CONSTRAINT "entregas_transportadoraId_fkey" FOREIGN KEY ("transportadoraId") REFERENCES "transportadoras"("id") ON DELETE SET NULL ON UPDATE CASCADE;
