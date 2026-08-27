-- Migração escrita à mão (drift do Prisma por causa da tabela n8n_chatbot,
-- fora do controle de migrations — NÃO rodar `prisma migrate reset`).
--
-- Achado A8 da auditoria de abrangência (pesquisa-abrangencia-modulos.md):
-- não existia vendedor/responsável comercial atribuído ao Cliente. A
-- comissão sempre nasceu de Orcamento.usuarioId (quem DIGITOU o orçamento
-- no sistema), nunca de quem efetivamente vendeu — um auxiliar
-- administrativo lançando o orçamento que a vendedora fechou por telefone
-- roubava a comissão dela.
--
-- Adiciona:
-- - clientes.vendedorId (FK pra usuarios, SET NULL): vendedor/responsável
--   comercial do cliente. Nullable, sem migração de dado — todo cliente
--   existente nasce sem vendedor atribuído (comportamento de hoje).
-- - parametros_grafica.comissaoSegueVendedorDoCliente (default false): liga
--   o encadeamento Cliente.vendedorId -> Comissao.usuarioId no fechamento
--   do pedido (ver atualizarStatusOrcamento em
--   src/app/orcamento/[id]/actions.ts e responderOrcamentoPublico em
--   src/app/o/[token]/actions.ts). default(false) preserva 100% do
--   comportamento atual pra quem já usa o sistema.
--
-- Ambas as colunas são aditivas — não quebram nenhum tenant existente.

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "vendedorId" TEXT;

-- AlterTable
ALTER TABLE "parametros_grafica" ADD COLUMN     "comissaoSegueVendedorDoCliente" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "clientes_vendedorId_idx" ON "clientes"("vendedorId");

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
