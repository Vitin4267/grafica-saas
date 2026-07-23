-- AlterTable
ALTER TABLE "graficas" ADD COLUMN "logoUrl" TEXT;

-- AlterTable
ALTER TABLE "pedidos" ADD COLUMN "arteAprovadaEm" TIMESTAMP(3),
ADD COLUMN "arteComentarioCliente" TEXT,
ADD COLUMN "arteLinkToken" TEXT,
ADD COLUMN "arteUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_arteLinkToken_key" ON "pedidos"("arteLinkToken");
