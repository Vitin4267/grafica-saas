-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A5 da Parte 5 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md): os 8 campos `endereco*` inline em
-- Cliente eram SIMULTANEAMENTE endereço de cadastro, de cobrança e de
-- entrega — não dava pra registrar que o faturamento vai pra matriz em São
-- Paulo e a caixa de rótulos vai pra fábrica em Extrema.
--
-- Adiciona:
-- - enum TipoEnderecoCliente + tabela enderecos_cliente (1 cliente -> N
--   endereços, com tipo PRINCIPAL/COBRANCA/ENTREGA, soft-delete via
--   `ativo`, nunca hard delete). Mesmo padrão estrutural de contatos_cliente
--   (migração 20260827170000_contato_cliente).
-- - orcamentos.enderecoEntregaId: FK opcional que CONVIVE com o texto livre
--   já existente orcamentos.localEntrega (nenhum dos dois é alterado ou
--   removido aqui).
--
-- Migração 100% aditiva: nenhuma coluna existente muda de tipo/obrigatoriedade,
-- nenhum dado é reescrito. Os campos `endereco*` de Cliente continuam sendo o
-- endereço FISCAL usado na emissão de nota — nada migra pra cá. Cliente sem
-- nenhum EnderecoCliente cadastrado continua funcionando exatamente como hoje.

-- CreateEnum
CREATE TYPE "TipoEnderecoCliente" AS ENUM ('PRINCIPAL', 'COBRANCA', 'ENTREGA');

-- CreateTable
CREATE TABLE "enderecos_cliente" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "apelido" TEXT NOT NULL,
    "tipo" "TipoEnderecoCliente" NOT NULL DEFAULT 'ENTREGA',
    "cep" TEXT,
    "logradouro" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "municipio" TEXT,
    "codigoIbge" TEXT,
    "uf" TEXT,
    "contatoNome" TEXT,
    "contatoTelefone" TEXT,
    "instrucoesEntrega" TEXT,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enderecos_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enderecos_cliente_clienteId_idx" ON "enderecos_cliente"("clienteId");

-- AddForeignKey
ALTER TABLE "enderecos_cliente" ADD CONSTRAINT "enderecos_cliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "orcamentos" ADD COLUMN     "enderecoEntregaId" TEXT;

-- CreateIndex
CREATE INDEX "orcamentos_enderecoEntregaId_idx" ON "orcamentos"("enderecoEntregaId");

-- AddForeignKey
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_enderecoEntregaId_fkey" FOREIGN KEY ("enderecoEntregaId") REFERENCES "enderecos_cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
