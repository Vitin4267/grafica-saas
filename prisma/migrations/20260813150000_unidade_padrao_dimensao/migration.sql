-- CreateEnum
CREATE TYPE "UnidadeDimensao" AS ENUM ('MM', 'CM', 'M');

-- AlterTable
ALTER TABLE "graficas" ADD COLUMN     "unidadePadraoDimensao" "UnidadeDimensao" NOT NULL DEFAULT 'CM';
