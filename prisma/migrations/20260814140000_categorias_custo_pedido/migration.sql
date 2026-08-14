-- CreateTable
CREATE TABLE "categorias_custo" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categorias_custo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categorias_custo_graficaId_nome_key" ON "categorias_custo"("graficaId", "nome");

-- CreateIndex
CREATE INDEX "categorias_custo_graficaId_idx" ON "categorias_custo"("graficaId");

-- AddForeignKey
ALTER TABLE "categorias_custo" ADD CONSTRAINT "categorias_custo_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "custos_pedido" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "categoriaCustoId" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custos_pedido_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "custos_pedido_graficaId_idx" ON "custos_pedido"("graficaId");

-- CreateIndex
CREATE INDEX "custos_pedido_pedidoId_idx" ON "custos_pedido"("pedidoId");

-- CreateIndex
CREATE INDEX "custos_pedido_categoriaCustoId_idx" ON "custos_pedido"("categoriaCustoId");

-- AddForeignKey
ALTER TABLE "custos_pedido" ADD CONSTRAINT "custos_pedido_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custos_pedido" ADD CONSTRAINT "custos_pedido_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custos_pedido" ADD CONSTRAINT "custos_pedido_categoriaCustoId_fkey" FOREIGN KEY ("categoriaCustoId") REFERENCES "categorias_custo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
