-- AlterTable
ALTER TABLE "pedidos" ADD COLUMN "producaoLinkToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_producaoLinkToken_key" ON "pedidos"("producaoLinkToken");

-- CreateTable
CREATE TABLE "responsaveis_estagio" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "status" "StatusPedido" NOT NULL,

    CONSTRAINT "responsaveis_estagio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "responsaveis_estagio_usuarioId_status_key" ON "responsaveis_estagio"("usuarioId", "status");

-- CreateIndex
CREATE INDEX "responsaveis_estagio_status_idx" ON "responsaveis_estagio"("status");

-- AddForeignKey
ALTER TABLE "responsaveis_estagio" ADD CONSTRAINT "responsaveis_estagio_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "tentativas_confirmacao_estagio" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tentativas_confirmacao_estagio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tentativas_confirmacao_estagio_pedidoId_createdAt_idx" ON "tentativas_confirmacao_estagio"("pedidoId", "createdAt");

-- CreateIndex
CREATE INDEX "tentativas_confirmacao_estagio_ip_createdAt_idx" ON "tentativas_confirmacao_estagio"("ip", "createdAt");
