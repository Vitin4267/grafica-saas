-- AlterTable
ALTER TABLE "orcamentos" ADD COLUMN     "respostaPublicaNome" TEXT,
ADD COLUMN     "respostaPublicaEm" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "pedidos" ADD COLUMN     "arteRespondidaPor" TEXT;

-- AlterTable
ALTER TABLE "logs_auditoria" ADD COLUMN     "valorAnterior" TEXT,
ADD COLUMN     "valorNovo" TEXT,
ADD COLUMN     "ip" TEXT;
