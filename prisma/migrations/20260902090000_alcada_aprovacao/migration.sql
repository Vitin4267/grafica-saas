-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A4 da Parte 6 da auditoria de abrangência (Configurações,
-- pesquisa-abrangencia-modulos.md, 2026-09-02): duas travas de autorização
-- por VALOR eram fixas em código — desconto de orçamento acima de
-- ParametrosGrafica.descontoMaxSemAprovacao só DONO/ADMIN aprova (limite
-- único pra gráfica inteira), e aprovação de SolicitacaoCompra não tinha
-- teto de valor nenhum. Esta migração cria só o cadastro (model novo,
-- aditivo); a resolução em 3 níveis (usuário > papel > comportamento de
-- hoje) fica em src/lib/alcada-aprovacao.ts.
--
-- Adiciona:
-- - enum "TipoAlcada": DESCONTO_ORCAMENTO / APROVACAO_COMPRA.
-- - tabela "alcadas_aprovacao": uma linha por alçada configurada, alvo
--   PAPEL (enum, sem FK de banco) OU usuarioId (sem FK de banco, mesmo
--   padrão de RegistroManutencao.registradoPorId) — exatamente um dos dois
--   preenchido, validado na action, não em constraint de banco.
--
-- Migração 100% aditiva: nenhuma tabela/coluna existente muda de
-- tipo/obrigatoriedade, nenhum dado é reescrito. Uma gráfica sem nenhuma
-- linha nesta tabela (todo tenant existente, no dia desta migração) não
-- muda de comportamento em nada — ver resolverLimiteDesconto/
-- resolverLimiteAprovacaoCompra.

-- CreateEnum
CREATE TYPE "TipoAlcada" AS ENUM ('DESCONTO_ORCAMENTO', 'APROVACAO_COMPRA');

-- CreateTable
CREATE TABLE "alcadas_aprovacao" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "tipo" "TipoAlcada" NOT NULL,
    "papel" "PapelUsuario",
    "usuarioId" TEXT,
    "limite" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "alcadas_aprovacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alcadas_aprovacao_graficaId_tipo_idx" ON "alcadas_aprovacao"("graficaId", "tipo");

-- AddForeignKey
ALTER TABLE "alcadas_aprovacao" ADD CONSTRAINT "alcadas_aprovacao_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
