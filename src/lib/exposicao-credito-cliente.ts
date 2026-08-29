import "server-only";
import { prisma } from "@/lib/prisma";
import { D, paraDecimal } from "@/lib/pricing/decimal";
import { saldoContaReceber } from "@/lib/baixa-financeira";

// Achado A6 da Parte 4 da auditoria de abrangência (2026-08-27) — soma de
// ContaReceber ainda em aberto do cliente (inclui tanto parcela ainda dentro
// do prazo quanto vencida: StatusContaReceber não distingue os dois estados,
// "vencido" é só PENDENTE com vencimento no passado — ver enum no schema).
// RECEBIDO/CANCELADO nunca entram: já não representam dívida em aberto.
//
// Nome deliberadamente diferente de src/lib/credito-cliente.ts (que é outro
// achado da mesma rodada — saldo de CRÉDITO DE CARTEIRA/adiantamento do
// cliente, um conceito de dinheiro que o cliente TEM disponível): isto aqui
// é o oposto, quanto o cliente DEVE em parcelas ainda não pagas.
//
// Filtra por orcamento.clienteId (ContaReceber não tem clienteId próprio,
// nasce vinculada a um Orcamento — ver comentário do model no schema)
// em vez de aceitar graficaId como parâmetro extra: quem chama já validou
// que o cliente pertence à gráfica antes de ter o id em mãos.
//
// Desde o achado A8 da Parte 4 (2026-08-29, recebimento parcial), PENDENTE
// sozinho subestimaria a exposição real: uma conta PARCIAL ainda tem saldo
// em aberto (só uma parte foi recebida), e ignorá-la deixaria o controle de
// limite de crédito liberar mais fôlego do que devia. PENDENTE continua
// somado pelo valor cheio (agregação direta no banco, mais barato); PARCIAL
// é a minoria dos casos, soma o SALDO calculado de cada uma.
export async function calcularExposicaoCreditoCliente(clienteId: string): Promise<number> {
  const agregadoPendente = await prisma.contaReceber.aggregate({
    where: { orcamento: { clienteId }, status: "PENDENTE" },
    _sum: { valor: true },
  });
  const totalPendente = agregadoPendente._sum.valor
    ? paraDecimal(agregadoPendente._sum.valor.toString())
    : new D(0);

  const parciais = await prisma.contaReceber.findMany({
    where: { orcamento: { clienteId }, status: "PARCIAL" },
    select: { id: true, valor: true, pagamentoId: true },
  });
  const saldosParciais = await Promise.all(parciais.map((c) => saldoContaReceber(prisma, c)));
  const totalParcial = saldosParciais.reduce((soma, s) => soma.plus(s), new D(0));

  return totalPendente.plus(totalParcial).toNumber();
}
