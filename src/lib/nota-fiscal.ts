import "server-only";

import { prisma } from "@/lib/prisma";
import type { DadosFiscaisGrafica, Prisma } from "@/generated/prisma/client";
import type { RegimeTributario } from "@/generated/prisma/enums";

// Dados fiscais "resolvidos" pra um orçamento/filial — DadosFiscaisFilial
// espelha DadosFiscaisGrafica campo a campo (só troca graficaId por
// filialId como chave de vínculo), então o mesmo tipo serve pros dois.
export type DadosFiscaisResolvidos = Omit<
  DadosFiscaisGrafica,
  "id" | "graficaId" | "createdAt" | "updatedAt"
>;

// Decide de onde vêm os dados fiscais usados pra emitir/consultar uma nota:
// se a filial do orçamento tiver seu próprio cadastro fiscal (CNPJ próprio,
// configurado em Configurações → Filiais → [filial]), usa ele; senão cai no
// comportamento de sempre — os dados fiscais da gráfica. `filialId` null
// (orçamento sem filial) sempre vai direto pro caminho da gráfica.
export async function resolverDadosFiscais(
  filialId: string | null,
  graficaId: string
): Promise<DadosFiscaisResolvidos | null> {
  if (filialId) {
    const dadosFilial = await prisma.dadosFiscaisFilial.findUnique({ where: { filialId } });
    if (dadosFilial) return dadosFilial;
  }
  return prisma.dadosFiscaisGrafica.findUnique({ where: { graficaId } });
}

// Checagem do que falta configurar antes de conseguir emitir uma nota fiscal
// — usada tanto pra decidir o que mostrar no NotaFiscalCard quanto (defesa em
// profundidade) dentro da própria Server Action de emissão.

export type DadosFiscaisParaChecagem = {
  focusNfeToken: string | null;
  cnpj: string | null;
  razaoSocial: string | null;
  enderecoLogradouro: string | null;
  enderecoNumero: string | null;
  enderecoBairro: string | null;
  enderecoMunicipio: string | null;
  enderecoUf: string | null;
  enderecoCep: string | null;
  regimeTributario: RegimeTributario;
  cstIcmsPadrao: string | null;
  icmsAliquotaPadrao: Prisma.Decimal | null;
  icmsModalidadeBaseCalculoPadrao: string | null;
  pisCofinsSituacaoTributariaPadrao: string | null;
} | null;

export type ClienteParaChecagem = {
  documento: string | null;
  enderecoLogradouro: string | null;
  enderecoNumero: string | null;
  enderecoBairro: string | null;
  enderecoMunicipio: string | null;
  enderecoUf: string | null;
  enderecoCep: string | null;
};

export type ItemParaChecagem = { nome: string; ncm: string | null };

export type ChecagemFiscal = { pronto: boolean; pendencias: string[] };

function enderecoCompleto(e: {
  enderecoLogradouro: string | null;
  enderecoNumero: string | null;
  enderecoBairro: string | null;
  enderecoMunicipio: string | null;
  enderecoUf: string | null;
  enderecoCep: string | null;
}): boolean {
  return Boolean(
    e.enderecoLogradouro &&
      e.enderecoNumero &&
      e.enderecoBairro &&
      e.enderecoMunicipio &&
      e.enderecoUf &&
      e.enderecoCep
  );
}

export function verificarProntidaoFiscal(input: {
  dadosFiscais: DadosFiscaisParaChecagem;
  cliente: ClienteParaChecagem;
  itens: ItemParaChecagem[];
}): ChecagemFiscal {
  const pendencias: string[] = [];

  if (!input.dadosFiscais?.focusNfeToken) {
    pendencias.push("Token da Focus NFe não configurado (Configurações → Dados fiscais).");
  }
  if (!input.dadosFiscais?.cnpj || !input.dadosFiscais.razaoSocial) {
    pendencias.push("CNPJ e razão social da gráfica não configurados (Configurações → Dados fiscais).");
  }
  if (!input.dadosFiscais || !enderecoCompleto(input.dadosFiscais)) {
    pendencias.push("Endereço da gráfica incompleto (Configurações → Dados fiscais).");
  }
  // Fora do Simples Nacional a nota usa CST-ICMS (não CSOSN) e precisa de
  // alíquota/base/modalidade de cálculo — sem isso a Focus NFe/SEFAZ rejeita
  // com HTTP 422. Bloqueado aqui, ANTES de bater na API, com mensagem clara
  // do que falta configurar.
  if (input.dadosFiscais && input.dadosFiscais.regimeTributario !== "SIMPLES_NACIONAL") {
    const faltando: string[] = [];
    if (!input.dadosFiscais.cstIcmsPadrao) faltando.push("CST-ICMS padrão");
    if (input.dadosFiscais.icmsAliquotaPadrao == null) faltando.push("alíquota de ICMS padrão");
    if (!input.dadosFiscais.icmsModalidadeBaseCalculoPadrao) {
      faltando.push("modalidade de base de cálculo do ICMS padrão");
    }
    if (!input.dadosFiscais.pisCofinsSituacaoTributariaPadrao) {
      faltando.push("situação tributária de PIS/COFINS padrão");
    }
    if (faltando.length > 0) {
      pendencias.push(
        `Regime tributário fora do Simples Nacional exige a configuração de: ${faltando.join(", ")} (Configurações → Dados fiscais).`
      );
    }
  }
  if (!input.cliente.documento) {
    pendencias.push("Cliente sem CPF/CNPJ cadastrado.");
  }
  if (!enderecoCompleto(input.cliente)) {
    pendencias.push("Endereço do cliente incompleto.");
  }
  const semNcm = input.itens.filter((i) => !i.ncm);
  if (semNcm.length > 0) {
    pendencias.push(`NCM não configurado para: ${semNcm.map((i) => i.nome).join(", ")}.`);
  }

  return { pronto: pendencias.length === 0, pendencias };
}

export type DestinatarioNotaFiscal = { email: string; nome: string };

export type NotificacaoNotaFiscal = {
  destinatarios: DestinatarioNotaFiscal[];
  graficaNome: string;
  corPrimaria: string | null;
  clienteNome: string;
  valorTotal: number;
};

// Helper compartilhado pelos dois caminhos de aprovação de orçamento
// (atualizarStatusOrcamento em src/app/orcamento/[id]/actions.ts e
// responderOrcamentoPublico em src/app/o/[token]/actions.ts) — chamado
// depois que a transação de aprovação já confirmou sucesso (nunca em caso de
// conflito de concorrência). Retorna null quando não há nada a notificar:
// ou ninguém está configurado como responsável pela área NOTA_FISCAL em
// /usuarios, ou o orçamento ainda não está pronto fiscalmente (falta CNPJ,
// endereço, NCM etc — o card na tela já mostra a pendência pro usuário
// resolver, não faz sentido mandar e-mail antes disso). O disparo do e-mail
// em si (after() + dispararEventoEmail, um por destinatário) fica em cada
// call site, não aqui — after() depende do contexto de requisição de cada
// rota.
export async function prepararNotificacaoNotaFiscal(
  orcamentoId: string,
  graficaId: string
): Promise<NotificacaoNotaFiscal | null> {
  const responsaveis = await prisma.responsavelAdministrativo.findMany({
    where: { area: "NOTA_FISCAL", usuario: { graficaId, desativadoEm: null } },
    include: { usuario: { select: { email: true, nome: true } } },
  });
  if (responsaveis.length === 0) return null;

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId },
    include: {
      cliente: true,
      grafica: { select: { nome: true, corPrimaria: true } },
      itens: { include: { itemGrafica: { include: { itemCatalogo: true } } } },
    },
  });
  if (!orcamento) return null;

  // Precisa do filialId do orçamento (acabou de carregar acima) antes de
  // saber se olha pros dados fiscais da filial ou da gráfica — por isso não
  // dá mais pra buscar em paralelo com o orçamento.
  const dadosFiscais = await resolverDadosFiscais(orcamento.filialId, graficaId);

  const checagem = verificarProntidaoFiscal({
    dadosFiscais,
    cliente: orcamento.cliente,
    itens: orcamento.itens.map((item) => ({
      nome: item.itemGrafica.itemCatalogo.nome,
      ncm: item.itemGrafica.itemCatalogo.ncm,
    })),
  });
  if (!checagem.pronto) return null;

  return {
    destinatarios: responsaveis.map((r) => ({ email: r.usuario.email, nome: r.usuario.nome })),
    graficaNome: orcamento.grafica.nome,
    corPrimaria: orcamento.grafica.corPrimaria,
    clienteNome: orcamento.cliente.nome,
    valorTotal: Number(orcamento.total),
  };
}
