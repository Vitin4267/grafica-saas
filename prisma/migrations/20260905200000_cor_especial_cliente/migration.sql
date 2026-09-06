-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado F8 da Parte 7 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md): todo campo de cor no schema era um
-- NÚMERO (corFrente/numeroCoresFlexo/coresRotulo — a CONTAGEM que o motor de
-- preço cobra), sem nenhum lugar pra dizer QUAIS cores. Cor especial/Pantone
-- é ao mesmo tempo tinta que se mistura por fórmula, clichê/tela a mais, e o
-- critério nº1 de aprovação/reclamação do cliente.
--
-- 100% aditivo, nenhuma coluna/tabela existente muda de nome/tipo/
-- obrigatoriedade: 2 tabelas novas ("cores_especiais_cliente" —
-- biblioteca de cor da marca do cliente — e "orcamento_item_cores" — qual
-- cor um item de orçamento usa, N:1, mesmo padrão de
-- "orcamento_item_hot_stampings"). Nenhum orçamento existente tem nenhuma
-- linha em "orcamento_item_cores" até o vendedor adicionar uma pela UI.
--
-- Puramente descritivo/organizacional — NUNCA lido por src/lib/pricing/
-- (guarda estática em src/app/orcamento/cor-especial-nao-entra-preco.test.ts).

-- CreateEnum
CREATE TYPE "SistemaCorEspecial" AS ENUM ('PANTONE', 'RAL', 'OUTRO');

-- CreateTable
CREATE TABLE "cores_especiais_cliente" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "clienteId" TEXT,
    "nome" TEXT NOT NULL,
    "referencia" TEXT NOT NULL,
    "sistemaCor" "SistemaCorEspecial" NOT NULL DEFAULT 'OUTRO',
    "formulaMistura" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cores_especiais_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orcamento_item_cores" (
    "id" TEXT NOT NULL,
    "orcamentoItemId" TEXT NOT NULL,
    "corEspecialId" TEXT,
    "nomeDeclarado" TEXT NOT NULL,

    CONSTRAINT "orcamento_item_cores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cores_especiais_cliente_graficaId_clienteId_idx" ON "cores_especiais_cliente"("graficaId", "clienteId");

-- CreateIndex
CREATE INDEX "orcamento_item_cores_orcamentoItemId_idx" ON "orcamento_item_cores"("orcamentoItemId");

-- CreateIndex
CREATE INDEX "orcamento_item_cores_corEspecialId_idx" ON "orcamento_item_cores"("corEspecialId");

-- AddForeignKey
ALTER TABLE "cores_especiais_cliente" ADD CONSTRAINT "cores_especiais_cliente_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cores_especiais_cliente" ADD CONSTRAINT "cores_especiais_cliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_item_cores" ADD CONSTRAINT "orcamento_item_cores_orcamentoItemId_fkey" FOREIGN KEY ("orcamentoItemId") REFERENCES "orcamento_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_item_cores" ADD CONSTRAINT "orcamento_item_cores_corEspecialId_fkey" FOREIGN KEY ("corEspecialId") REFERENCES "cores_especiais_cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
