import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { prisma } from "@/lib/prisma";
import { D, paraDecimal, type Dec } from "@/lib/pricing/decimal";

// Mesmo padrão de src/lib/billing/armazenamento.ts (ClientePrisma): as
// funções abaixo precisam rodar tanto fora de transação (leitura pra tela)
// quanto DENTRO da transação de aprovação do orçamento (consumo), sem
// duplicar a lógica pros dois casos.
type ClientePrisma = typeof prisma | Prisma.TransactionClient;

// Sinal de cada tipo de movimentação na soma do saldo. AJUSTE não entra
// aqui: o próprio valor já vem com o sinal certo (positivo ou negativo,
// ver comentário no schema em MovimentacaoCreditoCliente.valor), soma
// direto sem inverter.
const SINAL_TIPO: Record<"DEPOSITO" | "CONSUMO" | "ESTORNO", 1 | -1> = {
  DEPOSITO: 1,
  ESTORNO: 1,
  CONSUMO: -1,
};

// Saldo SEMPRE recalculado a partir da soma das movimentações — ver
// comentário em CreditoCliente no schema.prisma sobre por que nenhum campo
// `saldo` é armazenado direto (a validação de CONSUMO precisa reler o valor
// real dentro da própria transação, e um cache incrementado fora dessa
// checagem reabriria a corrida que ela existe pra fechar).
export async function saldoCreditoCliente(
  cliente: ClientePrisma,
  creditoClienteId: string
): Promise<Dec> {
  const movimentacoes = await cliente.movimentacaoCreditoCliente.findMany({
    where: { creditoClienteId },
    select: { tipo: true, valor: true },
  });
  return movimentacoes.reduce((soma: Dec, m) => {
    const valor = paraDecimal(m.valor.toString());
    if (m.tipo === "AJUSTE") return soma.plus(valor);
    return soma.plus(valor.times(SINAL_TIPO[m.tipo]));
  }, new D(0));
}

// Busca o CreditoCliente do cliente (não cria) — usado tanto pela tela de
// extrato quanto pelo consumo na aprovação. null quando o cliente nunca
// recebeu nenhum depósito adiantado (o caso de sempre, hoje).
export function buscarCreditoCliente(cliente: ClientePrisma, clienteId: string) {
  return cliente.creditoCliente.findUnique({ where: { clienteId } });
}

// Cria o CreditoCliente do cliente se ainda não existir — chamado só no
// momento de lançar a PRIMEIRA movimentação (mesmo espírito de
// criarContaPrepaga: o registro nasce vazio e ganha saldo na primeira
// movimentação, mas aqui não há nome pra escolher, então não faz sentido
// uma tela de "criar conta" separada — o depósito já cria tudo de uma vez).
async function garantirCreditoCliente(cliente: ClientePrisma, clienteId: string) {
  const existente = await buscarCreditoCliente(cliente, clienteId);
  if (existente) return existente;
  try {
    return await cliente.creditoCliente.create({ data: { clienteId } });
  } catch (erro) {
    // Duas requisições concorrentes lançando o primeiro depósito do mesmo
    // cliente (clienteId é @unique) — a segunda perde a corrida de create,
    // mas só precisa buscar o registro que a primeira acabou de criar.
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return cliente.creditoCliente.findUniqueOrThrow({ where: { clienteId } });
    }
    throw erro;
  }
}

export type ResultadoMovimentacaoCredito =
  | { ok: true; movimentacaoId: string }
  | { ok: false; mensagem: string };

// Lança DEPOSITO/ESTORNO/AJUSTE manual (tela de extrato) — cria o
// CreditoCliente na primeira chamada. Mesma filosofia não-bloqueante de
// lancarMovimentacaoContaPrepaga: nenhum destes tipos trava por saldo ficar
// negativo (só CONSUMO, ver lancarConsumoCreditoCliente abaixo, que tem a
// exigência explícita de nunca exceder o saldo disponível).
export async function lancarMovimentacaoManualCreditoCliente(
  cliente: ClientePrisma,
  params: {
    clienteId: string;
    tipo: "DEPOSITO" | "ESTORNO" | "AJUSTE";
    valor: Dec;
    descricao?: string;
    criadoPorId: string;
  }
): Promise<ResultadoMovimentacaoCredito> {
  const credito = await garantirCreditoCliente(cliente, params.clienteId);
  const mov = await cliente.movimentacaoCreditoCliente.create({
    data: {
      creditoClienteId: credito.id,
      tipo: params.tipo,
      valor: params.valor.toFixed(2),
      descricao: params.descricao ?? null,
      criadoPorId: params.criadoPorId,
    },
  });
  return { ok: true, movimentacaoId: mov.id };
}

// Chamado de DENTRO da transação de aprovação do orçamento
// (atualizarStatusOrcamento) — cria a MovimentacaoCreditoCliente tipo
// CONSUMO ligada ao orçamento. `valor` é SEMPRE re-derivado do saldo real
// aqui dentro, nunca aceito de fora sem checagem: um valor vindo do form
// só é um pedido, esta função é quem decide se cabe.
export async function lancarConsumoCreditoCliente(
  tx: Prisma.TransactionClient,
  params: { clienteId: string; orcamentoId: string; valor: Dec; criadoPorId: string }
): Promise<ResultadoMovimentacaoCredito> {
  if (params.valor.lte(0)) {
    return { ok: false, mensagem: "Valor de crédito a usar precisa ser maior que zero." };
  }
  const credito = await buscarCreditoCliente(tx, params.clienteId);
  if (!credito) {
    return { ok: false, mensagem: "Este cliente não tem crédito cadastrado." };
  }
  const saldo = await saldoCreditoCliente(tx, credito.id);
  if (params.valor.gt(saldo)) {
    return { ok: false, mensagem: "O valor de crédito informado é maior que o saldo disponível do cliente." };
  }
  const mov = await tx.movimentacaoCreditoCliente.create({
    data: {
      creditoClienteId: credito.id,
      tipo: "CONSUMO",
      valor: params.valor.toFixed(2),
      orcamentoId: params.orcamentoId,
      criadoPorId: params.criadoPorId,
    },
  });
  return { ok: true, movimentacaoId: mov.id };
}
