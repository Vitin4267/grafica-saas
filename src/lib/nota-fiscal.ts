import "server-only";

import { prisma } from "@/lib/prisma";
import type { DadosFiscaisGrafica, Prisma } from "@/generated/prisma/client";
import type { IndicadorInscricaoEstadual, RegimeTributario, TipoFrete } from "@/generated/prisma/enums";

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
  // Achado A1 da auditoria de abrangência — ver Cliente.indicadorInscricaoEstadual
  // no schema. Ausentes (undefined) num cliente antigo tratam como null: nenhuma
  // pendência nova pra quem nunca respondeu essas perguntas.
  indicadorInscricaoEstadual?: IndicadorInscricaoEstadual | null;
  inscricaoEstadual?: string | null;
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
  // Achado A1 da auditoria de abrangência — sem isso a Focus NFe/SEFAZ
  // rejeita com a rejeição 728 ("NF-e sem informação da IE do destinatário").
  // Bloqueado aqui, ANTES de bater na API, mesmo princípio das pendências
  // acima.
  if (input.cliente.indicadorInscricaoEstadual === "CONTRIBUINTE" && !input.cliente.inscricaoEstadual) {
    pendencias.push("Cliente marcado como contribuinte de ICMS sem Inscrição Estadual cadastrada.");
  }

  return { pronto: pendencias.length === 0, pendencias };
}

// Decide entre o CFOP interno (mesma UF) e o interestadual (UF diferente)
// pra um item de NF-e — achado A3 da auditoria de abrangência: antes disso
// TODA emissão usava cfopPadrao (5xxx) mesmo pra clientes de outro estado,
// silenciosamente. Escopo deliberadamente contido: não distingue cliente
// contribuinte vs não-contribuinte de ICMS (6102 vs 6108, com implicação de
// DIFAL) — isso depende do indicador de contribuinte do cliente, campo que
// ainda não existe no schema (achado A1, não construído). UF ausente de
// qualquer lado cai no cfopPadrao — mesmo comportamento de sempre, sem
// regressão pra dado incompleto.
export function resolverCfop(input: {
  ufEmitente: string | null;
  ufDestinatario: string | null;
  cfopPadrao: string;
  cfopPadraoInterestadual: string;
}): string {
  if (!input.ufEmitente || !input.ufDestinatario) return input.cfopPadrao;
  return input.ufEmitente === input.ufDestinatario ? input.cfopPadrao : input.cfopPadraoInterestadual;
}

// Achado R3 da auditoria de abrangência (Parte 2/Produção, rodada 20,
// 2026-09-03, resíduo do achado E1/Parte 2) — CFOP de industrialização por
// encomenda, usado pela NF-e de remessa (5901/6901) que a gráfica emite pro
// fornecedor terceirizado. RETORNO (5902/6902) só existe aqui pra manter a
// função simétrica/testável — fiscalmente essa saída pertence ao
// ESTABELECIMENTO TERCEIRIZADO (quem devolve a mercadoria industrializada),
// nunca à gráfica (que só a RECEBE de volta, entrada 1902/2902 do lado
// dela) — por isso só REMESSA tem um botão de emissão real no sistema (ver
// emitirNfeRemessaTerceirizacao em src/app/producao/terceirizacao-nfe-actions.ts).
// Diferente de resolverCfop (venda, cfopPadrao configurável por gráfica),
// estes 4 códigos são FIXOS pela tabela CFOP oficial — não fazem sentido
// como "padrão" configurável.
export type TipoOperacaoTerceirizacao = "REMESSA" | "RETORNO";

const CFOP_TERCEIRIZACAO: Record<TipoOperacaoTerceirizacao, { mesmaUf: string; ufDiferente: string }> = {
  REMESSA: { mesmaUf: "5901", ufDiferente: "6901" },
  RETORNO: { mesmaUf: "5902", ufDiferente: "6902" },
};

export const NATUREZA_OPERACAO_TERCEIRIZACAO: Record<TipoOperacaoTerceirizacao, string> = {
  REMESSA: "Remessa para industrialização por encomenda",
  RETORNO: "Retorno de industrialização por encomenda",
};

// UF ausente de qualquer lado cai no código de MESMA UF — mesmo critério de
// "sem regressão pra dado incompleto" de resolverCfop, aplicado aqui à
// opção mais comum (fornecedor terceirizado costuma ser da mesma região da
// gráfica).
export function resolverCfopTerceirizacao(input: {
  ufEmitente: string | null;
  ufFornecedor: string | null;
  tipo: TipoOperacaoTerceirizacao;
}): string {
  const codigos = CFOP_TERCEIRIZACAO[input.tipo];
  if (!input.ufEmitente || !input.ufFornecedor) return codigos.mesmaUf;
  return input.ufEmitente === input.ufFornecedor ? codigos.mesmaUf : codigos.ufDiferente;
}

// Checagem do que falta no CADASTRO DO FORNECEDOR antes de conseguir emitir
// a NF-e de remessa de terceirização pra ele — mesmo espírito de
// verificarProntidaoFiscal, mas focado só no destinatário (os dados
// FISCAIS DA GRÁFICA continuam checados por verificarProntidaoFiscal/
// resolverDadosFiscais, reaproveitados como estão). Fornecedor sem
// documento/endereço completos não pode ser destinatário de uma NF-e real —
// a terceirização em si nunca é bloqueada por isso (o cadastro
// documento/endereço é 100% opcional em Fornecedor), só o botão de emissão
// automática.
export type FornecedorParaChecagemNfe = {
  documento: string | null;
  enderecoLogradouro: string | null;
  enderecoNumero: string | null;
  enderecoBairro: string | null;
  enderecoMunicipio: string | null;
  enderecoUf: string | null;
  enderecoCep: string | null;
};

export function fornecedorProntoParaNfe(fornecedor: FornecedorParaChecagemNfe | null): boolean {
  if (!fornecedor) return false;
  return Boolean(
    fornecedor.documento &&
      fornecedor.enderecoLogradouro &&
      fornecedor.enderecoNumero &&
      fornecedor.enderecoBairro &&
      fornecedor.enderecoMunicipio &&
      fornecedor.enderecoUf &&
      fornecedor.enderecoCep
  );
}

// Mapeia TipoFrete (enum interno, ver schema.prisma) pro código modFrete
// que a Focus NFe/SEFAZ espera no campo modalidade_frete — achado B1 da
// auditoria de abrangência: o payload builder em focus-nfe.ts mandava "9"
// fixo, ignorando completamente Orcamento.frete. null (frete não informado
// no orçamento) cai em "9" (sem ocorrência de transporte) — mesmo
// comportamento de sempre pra orçamento sem esse campo preenchido, ex.:
// retirada no balcão, o caso mais comum de gráfica rápida.
export function resolverModalidadeFrete(frete: TipoFrete | null): string {
  const mapa: Record<TipoFrete, string> = {
    CIF_REMETENTE: "0",
    FOB_DESTINATARIO: "1",
    TERCEIROS: "2",
    PROPRIO_REMETENTE: "3",
    PROPRIO_DESTINATARIO: "4",
    SEM_FRETE: "9",
  };
  return frete ? mapa[frete] : "9";
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
