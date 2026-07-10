-- AlterTable
ALTER TABLE "graficas" ADD COLUMN     "compartilharMeuNegocio" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "acessoMeuNegocio" BOOLEAN NOT NULL DEFAULT false;
