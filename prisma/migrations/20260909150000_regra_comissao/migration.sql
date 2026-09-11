-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A12 da Parte 4 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md, Financeiro): hoje um único
-- Usuario.comissaoPercent (sem variação por produto/categoria/faixa de
-- margem), base global da gráfica, e Comissao.usuarioId obrigatório —
-- vendedor cadastrado só como texto livre em Orcamento.vendedor (sem
-- Usuario) não gera comissão nenhuma, silenciosamente (buraco de dinheiro
-- que não avisa).
--
-- ESCOPO DELIBERADAMENTE REDUZIDO — esta migration cobre só as partes 1 e 2
-- da proposta original:
-- 1. tabela "regras_comissao" — regra de comissão configurável por
--    especificidade (usuário/item/categoria/faixa de margem), resolvida por
--    src/lib/comissao.ts:resolverRegraComissao. Fallback OBRIGATÓRIO:
--    nenhuma regra cadastrada, ou nenhuma que bata, cai em
--    Usuario.comissaoPercent exatamente como hoje.
-- 2. "comissoes"."usuarioId" relaxado pra nullable + "representanteNome"
--    (snapshot de nome, mesmo padrão de
--    ApontamentoEtapa.operadorNomeDeclarado) — vendedor sem cadastro
--    (Orcamento.vendedor só texto livre) agora GERA Comissao mesmo assim,
--    com usuarioId=null. "estornadoEm" replica exatamente o mesmo padrão já
--    usado em CustoPedido.estornadoEm (carimba quando foi estornada, nunca
--    apaga a linha).
--
-- NÃO incluído nesta migration (parte 3 da proposta original, fora de
-- escopo por decisão explícita): ParametrosGrafica.comissaoGatilho
-- (liberação proporcional conforme ContaReceber é baixada) nem
-- FatorComissaoDesconto (fator por faixa de desconto concedido) — Comissao
-- continua sendo gerada 100% na aprovação do orçamento, snapshot único,
-- como hoje.
--
-- Relaxa NOT NULL (NÃO é 100% aditivo no sentido estrito — documentado
-- explicitamente aqui, seguindo o mesmo padrão já usado em
-- 20260906150000_compras_tipo_e_custo_aquisicao/"itemGraficaId" DROP NOT
-- NULL e 20260908140000_gang_run_bobina_1d): "comissoes"."usuarioId" deixa
-- de ser NOT NULL. Isso NUNCA quebra dado existente — toda linha de
-- Comissao já cadastrada até hoje já tem usuarioId preenchido (era
-- obrigatório até aqui), então a coluna simplesmente passa a ACEITAR null
-- daqui pra frente, sem tocar em nenhuma linha existente. A FK associada é
-- recriada com ON DELETE SET NULL (era RESTRICT) — consistente com o campo
-- agora sendo opcional: remover um Usuario não pode mais travar por causa de
-- uma Comissao antiga apontando pra ele.

-- AlterTable
ALTER TABLE "comissoes"
  ALTER COLUMN "usuarioId" DROP NOT NULL,
  ADD COLUMN "representanteNome" TEXT,
  ADD COLUMN "estornadoEm" TIMESTAMP(3);

-- AlterTable (fallback de percentual pro caso "vendedor sem cadastro" —
-- null preserva 100% o comportamento de hoje, ver comentário no schema)
ALTER TABLE "parametros_grafica" ADD COLUMN "comissaoRepresentanteSemCadastroPercent" DECIMAL(5,4);

-- DropForeignKey (recriada abaixo com ON DELETE SET NULL, ver comentário no topo)
ALTER TABLE "comissoes" DROP CONSTRAINT "comissoes_usuarioId_fkey";

-- AddForeignKey
ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "regras_comissao" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "prioridade" INTEGER NOT NULL DEFAULT 0,
    "usuarioId" TEXT,
    "itemCatalogoId" TEXT,
    "tipoItem" TEXT,
    "margemMinPercent" DECIMAL(5,4),
    "margemMaxPercent" DECIMAL(5,4),
    "percentual" DECIMAL(5,4) NOT NULL,
    "baseCalculo" "BaseComissao",
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regras_comissao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "regras_comissao_graficaId_ativa_idx" ON "regras_comissao"("graficaId", "ativa");

-- AddForeignKey
ALTER TABLE "regras_comissao" ADD CONSTRAINT "regras_comissao_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regras_comissao" ADD CONSTRAINT "regras_comissao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regras_comissao" ADD CONSTRAINT "regras_comissao_itemCatalogoId_fkey" FOREIGN KEY ("itemCatalogoId") REFERENCES "itens_catalogo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
