-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A4 da Parte 5 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md): cliente Pessoa Jurídica era tratado
-- como se fosse uma pessoa só (Cliente.email/telefone). Uma empresa cliente
-- recorrente tem vários contatos com papéis diferentes (comprador != quem
-- aprova arte != financeiro != recebimento) e não havia onde cadastrar isso.
--
-- Adiciona:
-- - enum FuncaoContatoCliente + tabela contatos_cliente (1 cliente -> N
--   contatos, soft-delete via `ativo`, nunca hard delete).
-- - orcamentos.contatoClienteId: FK opcional que CONVIVE com o snapshot em
--   texto já existente orcamentos.contatoNome/contatoEmail (nenhum dos dois
--   é alterado ou removido aqui).
--
-- Migração 100% aditiva: nenhuma coluna existente muda de tipo/obrigatoriedade,
-- nenhum dado é reescrito. Cliente sem nenhum ContatoCliente cadastrado
-- continua usando Cliente.email/Cliente.telefone exatamente como hoje.

-- CreateEnum
CREATE TYPE "FuncaoContatoCliente" AS ENUM ('COMPRADOR', 'FINANCEIRO', 'APROVACAO_ARTE', 'RECEBIMENTO', 'OUTRO');

-- CreateTable
CREATE TABLE "contatos_cliente" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cargo" TEXT,
    "departamento" TEXT,
    "email" TEXT,
    "telefone" TEXT,
    "whatsapp" TEXT,
    "funcao" "FuncaoContatoCliente" NOT NULL DEFAULT 'COMPRADOR',
    "funcaoOutro" TEXT,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contatos_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contatos_cliente_clienteId_idx" ON "contatos_cliente"("clienteId");

-- AddForeignKey
ALTER TABLE "contatos_cliente" ADD CONSTRAINT "contatos_cliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "orcamentos" ADD COLUMN     "contatoClienteId" TEXT;

-- CreateIndex
CREATE INDEX "orcamentos_contatoClienteId_idx" ON "orcamentos"("contatoClienteId");

-- AddForeignKey
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_contatoClienteId_fkey" FOREIGN KEY ("contatoClienteId") REFERENCES "contatos_cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
