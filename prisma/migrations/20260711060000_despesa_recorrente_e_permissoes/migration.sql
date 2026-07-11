-- CreateEnum
CREATE TYPE "ModuloPermissao" AS ENUM ('ORCAMENTO', 'CLIENTES', 'CATALOGO', 'PRODUCAO', 'FINANCEIRO', 'CONFIGURACOES');

-- AlterTable
ALTER TABLE "despesas" ADD COLUMN     "recorrente" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "serieRecorrenciaId" TEXT;

-- CreateTable
CREATE TABLE "permissoes_usuario" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "modulo" "ModuloPermissao" NOT NULL,
    "podeVer" BOOLEAN NOT NULL DEFAULT false,
    "podeEditar" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "permissoes_usuario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "permissoes_usuario_usuarioId_modulo_key" ON "permissoes_usuario"("usuarioId", "modulo");

-- CreateIndex
CREATE INDEX "despesas_graficaId_serieRecorrenciaId_idx" ON "despesas"("graficaId", "serieRecorrenciaId");

-- AddForeignKey
ALTER TABLE "permissoes_usuario" ADD CONSTRAINT "permissoes_usuario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
