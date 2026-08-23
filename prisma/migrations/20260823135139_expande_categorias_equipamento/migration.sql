-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CategoriaEquipamento" ADD VALUE 'CTP';
ALTER TYPE "CategoriaEquipamento" ADD VALUE 'IMPRESSORA_DIGITAL';
ALTER TYPE "CategoriaEquipamento" ADD VALUE 'SERIGRAFIA';
ALTER TYPE "CategoriaEquipamento" ADD VALUE 'SUBLIMACAO';
ALTER TYPE "CategoriaEquipamento" ADD VALUE 'ESTAMPAGEM_QUENTE';
ALTER TYPE "CategoriaEquipamento" ADD VALUE 'CORTE_LASER_ROUTER';
