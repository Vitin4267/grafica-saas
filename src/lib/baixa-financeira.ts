import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { prisma } from "@/lib/prisma";
import { D, paraDecimal, type Dec } from "@/lib/pricing/decimal";

// Mesmo padrão de src/lib/credito-cliente.ts: as funções abaixo precisam
// rodar tanto fora de transação (leitura pra tela) quanto DENTRO da
// transação que registra a baixa, sem duplicar a lógica pros dois casos.
type ClientePrisma = typeof prisma | Prisma.TransactionClient;

type ContaReceberParaSaldo = {
  id: string;
  valor: Prisma.Decimal | string | number;
  pagamentoId: string | null;
};

// Saldo em aberto de uma ContaReceber — SEMPRE recalculado, nunca
// armazenado (achado A8 da Parte 4 da auditoria de abrangência, mesma
// disciplina de saldoCreditoCliente). Dois caminhos possíveis de quitação
// (ver comentários no schema em ContaReceber.pagamentoId e em
// BaixaContaReceber), que nunca coexistem na mesma conta na prática, mas a
// soma cobre os dois por robustez:
//   - pagamentoId setado (caminho antigo, valor EXATO em um só pagamento):
//     a conta já nasceu quitada por definição — saldo 0, sem precisar somar
//     nada.
//   - linhas em BaixaContaReceber (caminho novo, parcial ou fechamento de
//     saldo remanescente): saldo = valor total - soma das baixas.
export async function saldoContaReceber(
  cliente: ClientePrisma,
  conta: ContaReceberParaSaldo
): Promise<Dec> {
  const total = paraDecimal(conta.valor.toString());
  if (conta.pagamentoId) return new D(0);
  const baixas = await cliente.baixaContaReceber.findMany({
    where: { contaReceberId: conta.id },
    select: { valor: true },
  });
  const pago = baixas.reduce((soma: Dec, b) => soma.plus(paraDecimal(b.valor.toString())), new D(0));
  return total.minus(pago);
}

type DespesaParaSaldo = {
  id: string;
  valor: Prisma.Decimal | string | number;
};

// Saldo em aberto de uma Despesa — mesma disciplina de saldoContaReceber
// acima, mas sem caminho legado: TODO pagamento contra uma Despesa (mesmo o
// primeiro, em valor cheio) passa a virar uma linha em PagamentoDespesa (ver
// marcarComoPaga em src/app/financeiro/actions.ts) desde o achado A8, então
// o saldo é sempre valor total menos a soma dessas linhas.
export async function saldoDespesa(cliente: ClientePrisma, despesa: DespesaParaSaldo): Promise<Dec> {
  const total = paraDecimal(despesa.valor.toString());
  const pagamentos = await cliente.pagamentoDespesa.findMany({
    where: { despesaId: despesa.id },
    select: { valor: true },
  });
  const pago = pagamentos.reduce((soma: Dec, p) => soma.plus(paraDecimal(p.valor.toString())), new D(0));
  return total.minus(pago);
}
