-- CreateEnum
CREATE TYPE "AreaAdministrativa" AS ENUM ('NOTA_FISCAL');

-- CreateTable
CREATE TABLE "responsaveis_administrativo" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "area" "AreaAdministrativa" NOT NULL,

    CONSTRAINT "responsaveis_administrativo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "responsaveis_administrativo_area_idx" ON "responsaveis_administrativo"("area");

-- CreateIndex
CREATE UNIQUE INDEX "responsaveis_administrativo_usuarioId_area_key" ON "responsaveis_administrativo"("usuarioId", "area");

-- AddForeignKey
ALTER TABLE "responsaveis_administrativo" ADD CONSTRAINT "responsaveis_administrativo_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
