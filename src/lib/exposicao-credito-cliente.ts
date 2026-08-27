import "server-only";
import { prisma } from "@/lib/prisma";

// Achado A6 da Parte 4 da auditoria de abrangência (2026-08-27) — soma de
// ContaReceber ainda PENDENTE do cliente (inclui tanto parcela ainda dentro
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
export async function calcularExposicaoCreditoCliente(clienteId: string): Promise<number> {
  const agregado = await prisma.contaReceber.aggregate({
    where: { orcamento: { clienteId }, status: "PENDENTE" },
    _sum: { valor: true },
  });
  return agregado._sum.valor ? Number(agregado._sum.valor) : 0;
}
