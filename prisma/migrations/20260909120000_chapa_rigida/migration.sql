-- Migracao escrita a mao (ver instrucao no schema -- NAO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A7 da auditoria de abrangencia (pesquisa-abrangencia-modulos.md,
-- "Nao existe nesting em CHAPA RIGIDA", 2026-09-09): FormatoFolha so era
-- lido no branch OFFSET, e o motor M2 exige BobinaMaterial (lanca erro
-- PECA_EXCEDE_BOBINA/MATERIAL_SEM_BOBINA sem ela) -- PVC, ACM, acrilico,
-- MDF, papelao Parana (ja no catalogo mestre como materia-prima, vendidos
-- em chapa fechada, ex: 1220x2440) nao tinham como calcular quantas pecas
-- saem de uma chapa. So dava pra usar SIMPLES (custo zero, sem motor).
--
-- Adiciona:
-- - ModeloCalculo.CHAPA_RIGIDA (15o rotulo) -- reaproveita o MESMO
--   algoritmo de imposicao 2D do Offset/Digital (calcularImposicao) sobre
--   FormatoFolha (relacao ja existente, reutilizada como esta -- nenhuma
--   tabela nova). custoBase = nChapas x preco da chapa (nao peso/gramatura
--   como no Offset) + Q x area da peca x custoImpressaoM2ChapaRigida
--   (impressao UV flatbed) + corte OPCIONAL via MaquinaTempo (achado A6,
--   ja existente).
-- - coluna "chapaId" em "itens_grafica": FK auto-referenciada pra outro
--   ItemGrafica (materia-prima chapa), mesmo padrao de "papelId"
--   (onDelete=Restrict -- nao deixa excluir uma chapa ainda em uso).
-- - coluna "custoImpressaoM2ChapaRigida" em "itens_grafica": R$/m2 impresso,
--   campo DEDICADO (mesmo padrao de custoImpressaoM2Editorial) -- nao
--   reaproveita custoImpressaoM2 do M2/DTF porque o motor/formula e
--   diferente (chapa fechada com preco fixo, sem nesting em bobina).
-- - "maquinaTempoId" (ja existente em "itens_grafica" desde o achado A6)
--   passa a ser lido tambem quando modeloCalculo=CHAPA_RIGIDA -- nenhuma
--   coluna nova, so novo uso em codigo (campo ja era nullable e opcional).
--
-- Migracao 100% aditiva: nenhuma tabela/coluna/enum existente muda de
-- nome/tipo/obrigatoriedade, nenhum dado e reescrito. Todo ItemGrafica
-- existente fica com chapaId/custoImpressaoM2ChapaRigida em NULL
-- (comportamento de hoje 100% preservado) e nenhum produto vira
-- CHAPA_RIGIDA sozinho -- so quando o Dono escolher esse modelo em
-- Catalogo.

-- AlterEnum
ALTER TYPE "ModeloCalculo" ADD VALUE 'CHAPA_RIGIDA';

-- AlterTable
ALTER TABLE "itens_grafica" ADD COLUMN     "chapaId" TEXT,
ADD COLUMN     "custoImpressaoM2ChapaRigida" DECIMAL(12,4);

-- CreateIndex
CREATE INDEX "itens_grafica_chapaId_idx" ON "itens_grafica"("chapaId");

-- AddForeignKey
ALTER TABLE "itens_grafica" ADD CONSTRAINT "itens_grafica_chapaId_fkey" FOREIGN KEY ("chapaId") REFERENCES "itens_grafica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
