-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado F6 da Parte 7 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md, "F. Documento e transação") —
-- classificado 🟢 Barato ("achado mais barato do relatório"): a gráfica não
-- tinha onde cadastrar a própria chave PIX/dados de recebimento. Hoje
-- Grafica só tem logo/cor/contato — zero dado de recebimento, apesar de
-- /o/[token] deixar o cliente aprovar sozinho, sem login, e o orçamento
-- terminar exatamente onde o dinheiro deveria começar.
--
-- Escopo deliberadamente enxuto: SÓ EXIBIÇÃO. Nenhum destes campos valida
-- formato (chavePix é texto livre — não confere CPF/CNPJ/e-mail válido),
-- confirma pagamento automaticamente, ou muda FormaPagamento/ContaReceber/
-- conciliação — isso continua 100% manual, como hoje.
--
-- Migração 100% aditiva: nenhuma coluna existente muda de tipo/
-- obrigatoriedade, nenhum dado é reescrito. Toda gráfica existente fica com
-- os 4 campos novos = NULL (comportamento de hoje 100% preservado: PDF e
-- /o/[token] só mostram "Como pagar" quando preenchido).

-- CreateEnum
CREATE TYPE "TipoChavePix" AS ENUM ('CPF', 'CNPJ', 'EMAIL', 'TELEFONE', 'ALEATORIA', 'OUTRO');

-- AlterTable
ALTER TABLE "graficas" ADD COLUMN     "chavePix" TEXT,
ADD COLUMN     "tipoChavePix" "TipoChavePix",
ADD COLUMN     "favorecidoPix" TEXT,
ADD COLUMN     "dadosBancarios" TEXT;
