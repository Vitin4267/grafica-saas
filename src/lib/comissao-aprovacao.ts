import "server-only";
import { prisma } from "@/lib/prisma";
import type { BaseComissao } from "@/lib/comissao";
import {
  calcularValorBase,
  calcularComissao,
  resolverRegraComissao,
  type RegraComissaoCandidata,
} from "@/lib/comissao";

// Achado A12 da Parte 4 da auditoria de abrangência (2026-09-09) — ponto
// ÚNICO de resolução dos dados de Comissao na aprovação do orçamento,
// compartilhado pelos dois call sites que criam Comissao (achado A8 já
// tinha duplicado a lógica entre os dois):
// src/app/orcamento/[id]/actions/status.ts (atualizarStatusOrcamento) e
// src/app/o/[token]/actions.ts (responderOrcamentoPublico). Extraído aqui
// pra não divergir os dois na hora de acrescentar RegraComissao +
// vendedor-sem-cadastro.
//
// Ordem de resolução de QUEM é o vendedor (a quem a comissão é atribuída):
// 1. ParametrosGrafica.comissaoSegueVendedorDoCliente + Cliente.vendedorId
//    (achado A8, já existia) — vendedor do CLIENTE.
// 2. Orcamento.vendedorUsuarioId (FK opcional, já existia no schema, mas
//    não era lida aqui antes desta feature) — vendedor REAL cadastrado.
// 3. Orcamento.vendedor (texto livre, sem Usuario nenhum) — vendedor SEM
//    cadastro: Comissao.usuarioId fica null, Comissao.representanteNome
//    recebe o texto (achado A12/Parte2, fecha o "buraco silencioso").
// 4. Orcamento.usuarioId (quem DIGITOU o orçamento) — fallback de sempre,
//    preservado EXATAMENTE pra quem não usa nenhum dos sinais acima.
//
// Ordem de resolução de QUANTO (percentual + base):
// 1. RegraComissao mais específica que bater (usuário resolvido acima +
//    item/categoria/margem agregados do orçamento) — achado A12/Parte1.
// 2. Sem regra: usuarioId != null → Usuario.comissaoPercent (comportamento
//    de sempre). usuarioId == null (vendedor sem cadastro) →
//    ParametrosGrafica.comissaoRepresentanteSemCadastroPercent (novo,
//    opt-in, null por padrão).
// 3. Sem percentual nenhum (nem regra, nem Usuario, nem fallback
//    configurado) e/ou percentual <= 0 → retorna null, NENHUMA Comissao é
//    criada — mesmo comportamento de hoje pra gráfica que nunca configurou
//    nada disso.
export type ItemParaResolucaoComissao = {
  precoTotal: number;
  custoTotal: number;
  itemCatalogoId: string | null;
  categoria: string | null;
};

export type ParametrosComissao = {
  comissaoVendedorBase: BaseComissao;
  comissaoSegueVendedorDoCliente: boolean;
  comissaoRepresentanteSemCadastroPercent: number | null;
};

export type ResolverDadosComissaoInput = {
  graficaId: string;
  parametros: ParametrosComissao | null;
  clienteVendedorId: string | null;
  orcamentoUsuarioId: string;
  orcamentoVendedorUsuarioId: string | null;
  orcamentoVendedorTexto: string | null;
  totalEscolhido: number;
  itens: ItemParaResolucaoComissao[];
};

export type DadosComissaoResolvidos = {
  usuarioId: string | null;
  representanteNome: string | null;
  baseCalculo: BaseComissao;
  percentualAplicado: number;
  valorBase: number;
  valorComissao: number;
};

// Valor único quando todo item do orçamento compartilha o mesmo valor nessa
// dimensão (itemCatalogoId ou categoria) — undefined quando o orçamento
// mistura mais de um, ou não tem item nenhum. RegraComissao com filtro
// nessa dimensão só bate quando dá pra apontar um valor único (mesmo
// espírito de "null = vale pra qualquer um" — indeterminado não é "vale pra
// qualquer um", então não confia numa regra que exige AQUELE valor
// específico).
function valorUnicoOuIndeterminado<T>(valores: (T | null)[]): T | null | undefined {
  if (valores.length === 0) return undefined;
  const primeiro = valores[0];
  return valores.every((v) => v === primeiro) ? primeiro : undefined;
}

export async function resolverDadosComissao(
  input: ResolverDadosComissaoInput
): Promise<DadosComissaoResolvidos | null> {
  const { graficaId, parametros, itens, totalEscolhido } = input;

  // 1. Quem é o vendedor (ver ordem no comentário acima).
  let usuarioAlvo: string | null;
  let representanteNome: string | null;
  if (parametros?.comissaoSegueVendedorDoCliente && input.clienteVendedorId) {
    usuarioAlvo = input.clienteVendedorId;
    representanteNome = null;
  } else if (input.orcamentoVendedorUsuarioId) {
    usuarioAlvo = input.orcamentoVendedorUsuarioId;
    representanteNome = null;
  } else if (input.orcamentoVendedorTexto && input.orcamentoVendedorTexto.trim()) {
    usuarioAlvo = null;
    representanteNome = input.orcamentoVendedorTexto.trim();
  } else {
    usuarioAlvo = input.orcamentoUsuarioId;
    representanteNome = null;
  }

  // 2. Contexto agregado da venda pra resolução de RegraComissao — margem
  // do orçamento inteiro (lucro/total), item/categoria só quando o
  // orçamento inteiro compartilha o mesmo (ver valorUnicoOuIndeterminado).
  const custoTotalSoma = itens.reduce((soma, item) => soma + Math.max(0, item.custoTotal), 0);
  const margemPercent = totalEscolhido > 0 ? (totalEscolhido - custoTotalSoma) / totalEscolhido : null;
  const itemCatalogoId = valorUnicoOuIndeterminado(itens.map((i) => i.itemCatalogoId));
  const tipoItem = valorUnicoOuIndeterminado(itens.map((i) => i.categoria));

  const [regrasAtivas, usuarioVendedor] = await Promise.all([
    prisma.regraComissao.findMany({
      where: { graficaId, ativa: true },
      select: {
        id: true,
        prioridade: true,
        usuarioId: true,
        itemCatalogoId: true,
        tipoItem: true,
        margemMinPercent: true,
        margemMaxPercent: true,
        percentual: true,
        baseCalculo: true,
      },
    }),
    usuarioAlvo
      ? prisma.usuario.findUnique({ where: { id: usuarioAlvo }, select: { comissaoPercent: true } })
      : Promise.resolve(null),
  ]);

  const candidatas: RegraComissaoCandidata[] = regrasAtivas.map((regra) => ({
    id: regra.id,
    prioridade: regra.prioridade,
    usuarioId: regra.usuarioId,
    itemCatalogoId: regra.itemCatalogoId,
    tipoItem: regra.tipoItem,
    margemMinPercent: regra.margemMinPercent ? Number(regra.margemMinPercent) : null,
    margemMaxPercent: regra.margemMaxPercent ? Number(regra.margemMaxPercent) : null,
    percentual: Number(regra.percentual),
    baseCalculo: regra.baseCalculo,
  }));

  const regraResolvida = resolverRegraComissao(candidatas, {
    usuarioId: usuarioAlvo,
    itemCatalogoId,
    tipoItem,
    margemPercent,
  });

  // 3. Quanto — regra vence; sem regra, cai no fallback de sempre
  // (Usuario.comissaoPercent) ou, só pra vendedor sem cadastro, no
  // fallback opt-in de ParametrosGrafica.
  let percentual: number | null;
  let baseCalculo: BaseComissao;
  if (regraResolvida) {
    percentual = regraResolvida.percentual;
    baseCalculo = regraResolvida.baseCalculo ?? parametros?.comissaoVendedorBase ?? "VALOR";
  } else if (usuarioAlvo) {
    percentual = usuarioVendedor?.comissaoPercent ? Number(usuarioVendedor.comissaoPercent) : null;
    baseCalculo = parametros?.comissaoVendedorBase ?? "VALOR";
  } else {
    percentual = parametros?.comissaoRepresentanteSemCadastroPercent ?? null;
    baseCalculo = parametros?.comissaoVendedorBase ?? "VALOR";
  }

  if (!percentual || percentual <= 0) return null;

  const valorBase = calcularValorBase(totalEscolhido, itens, baseCalculo);
  const valorComissao = calcularComissao(valorBase, percentual);

  return {
    usuarioId: usuarioAlvo,
    representanteNome,
    baseCalculo,
    percentualAplicado: percentual,
    valorBase,
    valorComissao,
  };
}
