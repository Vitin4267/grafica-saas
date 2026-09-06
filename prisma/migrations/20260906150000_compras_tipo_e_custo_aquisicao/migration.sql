-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achados A1 e A2 da Parte 3 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md, "Compras"):
--
-- A1 — Só dá pra comprar MATÉRIA-PRIMA do próprio catálogo. Torna
-- "solicitacoes_compra"."itemGraficaId" NULLABLE + adiciona
-- "descricaoLivre" (alvo estruturado OU descrição livre — pelo menos um
-- dos dois é exigido na aplicação, não em constraint de banco) + enum
-- "TipoCompra" (fechado + OUTRO, mesmo padrão do resto do schema) +
-- "tipoCompraOutro". A FK de "itemGraficaId" continua existindo (só deixa
-- de ser NOT NULL) — nenhuma constraint precisa ser recriada, FK nula
-- simplesmente não é validada contra o pai.
--
-- A2 — "rota curta" de custo de aquisição real: 4 colunas Decimal
-- opcionais (frete, IPI, ICMS creditável, desconto) — o campo derivado
-- "custoAquisicaoTotal" é calculado on-the-fly na aplicação (ver
-- avancarStatusCompra em src/app/compras/status-transicao.ts e
-- src/lib/custo-aquisicao-compra.ts), nunca persistido como coluna.
--
-- 100% aditiva: nenhuma tabela/coluna/enum existente muda de nome/tipo,
-- nenhum dado é reescrito. TipoCompra é um enum NOVO (não adiciona valor a
-- um enum já existente), então não há restrição de transação separada
-- (ALTER TYPE ... ADD VALUE só é problema pra enum JÁ existente usado na
-- mesma transação). Toda linha de "solicitacoes_compra" já existente
-- recebe tipoCompra=MATERIA_PRIMA via DEFAULT — comportamento de hoje
-- preservado: MovimentacaoEstoque continua sendo gerada em RECEBIDO
-- exatamente como antes pra toda solicitação pré-existente (todas têm
-- itemGraficaId preenchido, condição da nova checagem condicional).

-- CreateEnum
CREATE TYPE "TipoCompra" AS ENUM ('MATERIA_PRIMA', 'SERVICO_TERCEIRIZADO', 'PECA_MANUTENCAO', 'EQUIPAMENTO', 'CONSUMO_INTERNO', 'OUTRO');

-- AlterTable
ALTER TABLE "solicitacoes_compra"
  ALTER COLUMN "itemGraficaId" DROP NOT NULL,
  ADD COLUMN "descricaoLivre" TEXT,
  ADD COLUMN "tipoCompra" "TipoCompra" NOT NULL DEFAULT 'MATERIA_PRIMA',
  ADD COLUMN "tipoCompraOutro" TEXT,
  ADD COLUMN "valorFrete" DECIMAL(12,2),
  ADD COLUMN "valorIpi" DECIMAL(12,2),
  ADD COLUMN "valorIcmsCreditavel" DECIMAL(12,2),
  ADD COLUMN "valorDesconto" DECIMAL(12,2);
