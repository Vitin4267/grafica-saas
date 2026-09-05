import "server-only";

import type { IndicadorInscricaoEstadual, OrigemMercadoria, TipoFrete } from "@/generated/prisma/enums";
import { resolverModalidadeFrete } from "@/lib/nota-fiscal";

// Cliente fino da API da Focus NFe (https://doc.focusnfe.com.br) — sem SDK
// externo. Payload confirmado contra o exemplo oficial da própria Focus NFe
// (github.com/FocusNFe/javascript, NFe/v2/autorizar.js e consultar.js): os
// campos de emitente/destinatario são FLAT (prefixo _emitente/_destinatario),
// não objetos aninhados, e vêm em toda chamada — não ficam pré-configurados
// na conta da Focus NFe.

export type AmbienteFocusNfe = "homologacao" | "producao";

const BASE_URL: Record<AmbienteFocusNfe, string> = {
  homologacao: "https://homologacao.focusnfe.com.br",
  producao: "https://api.focusnfe.com.br",
};

// Texto exigido pela SEFAZ em ambiente de homologação — uma nota de teste
// nunca pode usar o nome real do destinatário. Aplicado sempre que
// ambiente="homologacao", independente do que for passado em nomeDestinatario.
const NOME_DESTINATARIO_HOMOLOGACAO =
  "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

export type ConfigFocusNfe = { token: string; ambiente: AmbienteFocusNfe };

export type EnderecoFocusNfe = {
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
};

export type ItemNfe = {
  numeroItem: number;
  codigoProduto: string;
  descricao: string;
  ncm: string;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorBruto: number;
  // Código de origem da mercadoria (Tabela B do CST/ICMS) — achado N6 da
  // auditoria de abrangência. null/ausente (item sem origem configurada,
  // nunca deveria acontecer já que ItemCatalogo.origemMercadoria tem
  // @default(NACIONAL_0), mas é defesa em profundidade) cai em "0"
  // (nacional) — mesmo comportamento fixo de sempre. Ver mapearOrigemMercadoria.
  origemMercadoria?: OrigemMercadoria | null;
  icmsSituacaoTributaria: string; // CSOSN (Simples Nacional) ou CST-ICMS (Regime Normal)
  // Campos abaixo só existem pra gráfica em Regime Normal (Lucro
  // Presumido/Real) — Simples Nacional não manda nenhum deles, e o payload
  // builder cai no comportamento de sempre (icms_origem "0" sozinho,
  // pis/cofins fixos "07") quando estão ausentes. Ver
  // verificarProntidaoFiscal em src/lib/nota-fiscal.ts, que garante os 4
  // preenchidos juntos antes de chegar aqui pra Regime Normal.
  icmsAliquota?: number; // % — ex: 18 (não 0.18)
  icmsBaseCalculo?: number; // valor em R$ usado como base do cálculo do ICMS
  icmsModalidadeBaseCalculo?: string; // tabela 0-3
  pisSituacaoTributaria?: string; // default "07" quando ausente
  cofinsSituacaoTributaria?: string; // default "07" quando ausente
};

export type EmitirNfeInput = {
  referencia: string;
  naturezaOperacao: string;
  emitente: {
    cnpj: string;
    nome: string;
    nomeFantasia: string;
    inscricaoEstadual: string;
  } & EnderecoFocusNfe;
  destinatario: {
    documento: string; // CPF (11 dígitos) ou CNPJ (14 chars, alfanumérico desde 31/07/2026) — decidido pelo tamanho, ver normalizarDocumentoDestinatario
    nome: string;
    // Achado A1 da auditoria de abrangência — razão social tem preferência
    // sobre `nome` (que pode ser o nome fantasia digitado pelo balconista,
    // sem validade jurídica pra nota fiscal). Ausente/null cai em `nome`,
    // mesmo comportamento de sempre.
    razaoSocial?: string | null;
    // null/ausente = cliente antigo, sem indicador cadastrado — o payload
    // builder não manda nenhum dos dois campos abaixo (comportamento de
    // hoje). Ver mapearIndicadorInscricaoEstadual.
    indicadorInscricaoEstadual?: IndicadorInscricaoEstadual | null;
    inscricaoEstadual?: string | null;
  } & EnderecoFocusNfe;
  itens: ItemNfe[];
  valorTotal: number;
  // Modalidade de frete do orçamento (Orcamento.frete) — achado B1 da
  // auditoria de abrangência: até aqui o payload builder mandava "9" fixo
  // pra TODO orçamento, ignorando esse campo. null (frete não preenchido no
  // orçamento) cai em "9" via resolverModalidadeFrete, o mesmo
  // comportamento de sempre.
  frete?: TipoFrete | null;
  // Valor do frete em R$ (Orcamento.valorFrete) — achado F3 da auditoria de
  // abrangência: até aqui o payload builder mandava "0" fixo pra TODO
  // orçamento, mesmo quando um valor de frete estava preenchido. null/
  // ausente (frete não preenchido, o caso de sempre até esta feature) cai
  // em "0" via resolverValorFrete — mesmo comportamento de sempre, zero
  // regressão.
  valorFrete?: number | null;
};

export type RespostaFocusNfe = {
  status: "processando_autorizacao" | "autorizado" | "cancelado" | "erro_autorizacao" | "denegado";
  numero?: string;
  serie?: string;
  chaveNfe?: string;
  caminhoXml?: string;
  caminhoDanfe?: string;
  mensagemSefaz?: string;
  mensagemErro?: string;
};

class ErroFocusNfe extends Error {
  constructor(
    message: string,
    public readonly detalhes?: unknown
  ) {
    super(message);
    this.name = "ErroFocusNfe";
  }
}

function autorizacaoBasica(token: string): string {
  return "Basic " + Buffer.from(`${token}:`).toString("base64");
}

// Remove pontuação de um documento (CNPJ ou CPF) e normaliza pra maiúsculo.
// Mantém letras de CNPJ alfanumérico (vigente desde 31/07/2026).
function limparDocumento(documento: string): string {
  return documento.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

// Normaliza o documento do destinatário e decide CNPJ×CPF pelo COMPRIMENTO do
// resultado, nunca por regex de dígito puro — achado A2 da auditoria de
// abrangência (2026-08-24): `documento.replace(/\D/g, "")` apagava as letras
// do CNPJ alfanumérico (12 posições alfanuméricas + 2 dígitos verificadores
// numéricos, obrigatório desde 31/07/2026 — Serpro), e o número mutilado
// (ex: "12ABC34501DE35" → "120134501035", 9 dígitos) caia no branch de CPF,
// truncado, sem erro nenhum. CNPJ é sempre 14 caracteres (numérico ou
// alfanumérico); CPF é sempre 11 dígitos — não há ambiguidade nenhuma
// decidindo pelo comprimento depois de só remover pontuação (mantendo letras).
export function normalizarDocumentoDestinatario(
  documento: string
): { cnpj_destinatario: string } | { cpf_destinatario: string } {
  const limpo = limparDocumento(documento);
  return limpo.length === 14 ? { cnpj_destinatario: limpo } : { cpf_destinatario: limpo };
}

// Normaliza o CNPJ do emitente (gráfica). CNPJ é sempre 14 caracteres
// (numérico ou alfanumérico desde 31/07/2026). Remove pontuação e mantém
// letras, normalizando pra maiúsculo.
export function normalizarCnpjEmitente(cnpj: string): string {
  return limparDocumento(cnpj);
}

// Mapeia IndicadorInscricaoEstadual (enum interno, ver schema.prisma) pro
// código indIEDest que a Focus NFe/SEFAZ espera — achado A1 da auditoria de
// abrangência (2026-08-27): 1 = contribuinte de ICMS, 2 = contribuinte
// isento de inscrição, 9 = não contribuinte (tag indIEDest da NF-e 4.0,
// confirmado em pesquisa-abrangencia-modulos.md contra a doc da Focus NFe e
// referência de rejeições SEFAZ 728/791). null (cliente antigo, sem
// indicador cadastrado) retorna undefined — mesmo comportamento de
// resolverModalidadeFrete/normalizarDocumentoDestinatario pra dado ausente.
export function mapearIndicadorInscricaoEstadual(
  indicador: IndicadorInscricaoEstadual | null
): string | undefined {
  if (!indicador) return undefined;
  const mapa: Record<IndicadorInscricaoEstadual, string> = {
    CONTRIBUINTE: "1",
    ISENTO: "2",
    NAO_CONTRIBUINTE: "9",
  };
  return mapa[indicador];
}

// Mapeia OrigemMercadoria (enum interno, ver schema.prisma) pro código
// icms_origem que a Focus NFe/SEFAZ espera (Tabela B do CST/ICMS, Convênio
// S/N 70/2012) — achado N6 da auditoria de abrangência (2026-09-03): até
// aqui mapearItemNfePayload mandava "0" fixo pra todo item, de toda
// gráfica. null/undefined (item sem origem configurada) cai em "0"
// (nacional) — mesmo comportamento de sempre, mesmo princípio de dado
// ausente de mapearIndicadorInscricaoEstadual/resolverModalidadeFrete.
export function mapearOrigemMercadoria(origem: OrigemMercadoria | null | undefined): string {
  if (!origem) return "0";
  const mapa: Record<OrigemMercadoria, string> = {
    NACIONAL_0: "0",
    ESTRANGEIRA_IMPORTACAO_DIRETA_1: "1",
    ESTRANGEIRA_MERCADO_INTERNO_2: "2",
    NACIONAL_CONTEUDO_IMPORTACAO_40_A_70_3: "3",
    NACIONAL_PROCESSO_PRODUTIVO_BASICO_4: "4",
    NACIONAL_CONTEUDO_IMPORTACAO_ATE_40_5: "5",
    ESTRANGEIRA_IMPORTACAO_DIRETA_SEM_SIMILAR_6: "6",
    ESTRANGEIRA_MERCADO_INTERNO_SEM_SIMILAR_7: "7",
    NACIONAL_CONTEUDO_IMPORTACAO_ACIMA_70_8: "8",
  };
  return mapa[origem];
}

// Monta indicador_inscricao_estadual_destinatario + inscricao_estadual_destinatario
// — extraído como função pura (sem fetch, sem I/O) pra ser testável direto,
// mesmo padrão de mapearItemNfePayload. A IE só é incluída quando o
// indicador é CONTRIBUINTE: mandar IE junto de ISENTO/NAO_CONTRIBUINTE é
// exatamente a rejeição SEFAZ 791. Indicador ausente (cliente antigo) não
// manda nenhum dos dois campos — mesmo comportamento de sempre.
export function montarCamposIeDestinatario(
  indicador: IndicadorInscricaoEstadual | null | undefined,
  inscricaoEstadual: string | null | undefined
): Record<string, string> {
  const codigo = mapearIndicadorInscricaoEstadual(indicador ?? null);
  if (!codigo) return {};
  return {
    indicador_inscricao_estadual_destinatario: codigo,
    ...(indicador === "CONTRIBUINTE" && inscricaoEstadual ? { inscricao_estadual_destinatario: inscricaoEstadual } : {}),
  };
}

// Nome de destinatário pra nota fiscal — extraído como função pura pra ser
// testável direto, mesmo padrão de montarCamposIeDestinatario acima. A nota
// DEVE usar razão social (nome fantasia não tem validade jurídica pra
// documento fiscal); razaoSocial ausente/vazia (cliente antigo, ou pessoa
// física) cai em `nome`, comportamento de sempre.
export function resolverNomeDestinatario(destinatario: { nome: string; razaoSocial?: string | null }): string {
  return destinatario.razaoSocial || destinatario.nome;
}

// Resolve o valor_frete do payload — achado F3 da auditoria de abrangência:
// extraído como função pura (sem fetch, sem I/O) pra ser testável direto,
// mesmo padrão de resolverModalidadeFrete (src/lib/nota-fiscal.ts). null/
// undefined/negativo (frete não preenchido no orçamento, ou dado inválido)
// cai em "0" — mesmo comportamento fixo de sempre que o payload builder já
// tinha ANTES desta feature existir, zero regressão pra quem nunca usou
// Orcamento.valorFrete.
export function resolverValorFrete(valorFrete: number | null | undefined): string {
  if (typeof valorFrete !== "number" || !Number.isFinite(valorFrete) || valorFrete < 0) {
    return "0";
  }
  return valorFrete.toFixed(2);
}

function montarEnderecoPayload(prefixo: string, endereco: EnderecoFocusNfe) {
  return {
    [`logradouro_${prefixo}`]: endereco.logradouro,
    [`numero_${prefixo}`]: endereco.numero,
    [`bairro_${prefixo}`]: endereco.bairro,
    [`municipio_${prefixo}`]: endereco.municipio,
    [`uf_${prefixo}`]: endereco.uf,
    [`cep_${prefixo}`]: endereco.cep.replace(/\D/g, ""),
  };
}

// Em erro de validação (HTTP 422), a Focus NFe devolve um array de
// {codigo, mensagem} (às vezes um objeto único), não o formato normal de
// status de nota — tratado à parte pra não perder a mensagem real do erro.
function extrairMensagemDeErroValidacao(json: unknown): string | undefined {
  if (Array.isArray(json)) {
    const mensagens = json
      .map((erro) => (erro && typeof erro === "object" && "mensagem" in erro ? String(erro.mensagem) : null))
      .filter((m): m is string => Boolean(m));
    return mensagens.length > 0 ? mensagens.join("; ") : undefined;
  }
  if (json && typeof json === "object" && "mensagem" in json) {
    return String((json as Record<string, unknown>).mensagem);
  }
  return undefined;
}

function mapearResposta(json: Record<string, unknown>): RespostaFocusNfe {
  return {
    status: json.status as RespostaFocusNfe["status"],
    numero: typeof json.numero === "string" ? json.numero : undefined,
    serie: typeof json.serie === "string" ? json.serie : undefined,
    chaveNfe: typeof json.chave_nfe === "string" ? json.chave_nfe : undefined,
    caminhoXml:
      typeof json.caminho_xml_nota_fiscal === "string" ? json.caminho_xml_nota_fiscal : undefined,
    caminhoDanfe: typeof json.caminho_danfe === "string" ? json.caminho_danfe : undefined,
    mensagemSefaz: typeof json.mensagem_sefaz === "string" ? json.mensagem_sefaz : undefined,
    mensagemErro: typeof json.mensagem === "string" ? json.mensagem : undefined,
  };
}

function completarUrlArquivo(caminho: string | undefined, ambiente: AmbienteFocusNfe) {
  if (!caminho) return undefined;
  return `${BASE_URL[ambiente]}${caminho}`;
}

// Mapeamento de item pra payload da Focus NFe — extraído como função pura
// (sem fetch, sem I/O) pra ser testável direto. Nomes de campo confirmados
// contra doc.focusnfe.com.br/reference/emitir_nfe e
// campos.focusnfe.com.br/nfe/ItemNotaFiscalXML.html (2026-08-23): CST normal
// usa icms_situacao_tributaria + icms_modalidade_base_calculo +
// icms_base_calculo + icms_aliquota + icms_valor; CSOSN (Simples Nacional)
// usa só icms_situacao_tributaria. icms_valor é derivado
// (base_calculo × aliquota/100), nunca configurado diretamente — não existe
// campo "padrão" pra ele nos Dados fiscais. icms_origem vem de
// item.origemMercadoria (achado N6) via mapearOrigemMercadoria, não mais
// fixo — item sem origem configurada cai em "0" (nacional), mesmo
// comportamento de sempre.
export function mapearItemNfePayload(item: ItemNfe): Record<string, unknown> {
  const temIcmsRegimeNormal =
    item.icmsAliquota !== undefined &&
    item.icmsBaseCalculo !== undefined &&
    item.icmsModalidadeBaseCalculo !== undefined;

  const icmsValor = temIcmsRegimeNormal
    ? (item.icmsBaseCalculo! * item.icmsAliquota!) / 100
    : undefined;

  return {
    numero_item: String(item.numeroItem),
    codigo_produto: item.codigoProduto,
    descricao: item.descricao,
    cfop: item.cfop,
    unidade_comercial: item.unidade,
    quantidade_comercial: String(item.quantidade),
    valor_unitario_comercial: item.valorUnitario.toFixed(4),
    valor_unitario_tributavel: item.valorUnitario.toFixed(4),
    unidade_tributavel: item.unidade,
    codigo_ncm: item.ncm,
    quantidade_tributavel: String(item.quantidade),
    valor_bruto: item.valorBruto.toFixed(2),
    icms_origem: mapearOrigemMercadoria(item.origemMercadoria),
    icms_situacao_tributaria: item.icmsSituacaoTributaria,
    ...(temIcmsRegimeNormal
      ? {
          icms_modalidade_base_calculo: item.icmsModalidadeBaseCalculo,
          icms_base_calculo: item.icmsBaseCalculo!.toFixed(2),
          icms_aliquota: item.icmsAliquota!.toFixed(2),
          icms_valor: icmsValor!.toFixed(2),
        }
      : {}),
    pis_situacao_tributaria: item.pisSituacaoTributaria ?? "07",
    cofins_situacao_tributaria: item.cofinsSituacaoTributaria ?? "07",
  };
}

// A Focus NFe espera data_emissao/data_entrada_saida em horário LOCAL do
// emitente (confirmado no exemplo oficial da doc — doc.focusnfe.com.br/
// reference/emitir_nfe — que mostra "2024-01-15T12:00:00-03:00", ou seja,
// horário de São Paulo). Gera o horário de Brasília via Intl, sem depender
// do TZ do processo (a Vercel roda em UTC).
function agoraBrasilIso(): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(new Date())
    .reduce((a, x) => ({ ...a, [x.type]: x.value }), {} as Record<string, string>);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

export async function emitirNfe(
  config: ConfigFocusNfe,
  input: EmitirNfeInput
): Promise<RespostaFocusNfe> {
  const agora = agoraBrasilIso();
  const documentoDestinatario = normalizarDocumentoDestinatario(input.destinatario.documento);
  const ehHomologacao = config.ambiente === "homologacao";

  const payload = {
    natureza_operacao: input.naturezaOperacao,
    data_emissao: agora,
    data_entrada_saida: agora,
    tipo_documento: "1", // saída
    finalidade_emissao: "1", // normal
    modalidade_frete: resolverModalidadeFrete(input.frete ?? null),

    cnpj_emitente: normalizarCnpjEmitente(input.emitente.cnpj),
    nome_emitente: input.emitente.nome,
    nome_fantasia_emitente: input.emitente.nomeFantasia,
    inscricao_estadual_emitente: input.emitente.inscricaoEstadual,
    ...montarEnderecoPayload("emitente", input.emitente),

    nome_destinatario: ehHomologacao
      ? NOME_DESTINATARIO_HOMOLOGACAO
      : resolverNomeDestinatario(input.destinatario),
    ...documentoDestinatario,
    ...montarEnderecoPayload("destinatario", input.destinatario),
    pais_destinatario: "Brasil",
    ...montarCamposIeDestinatario(
      input.destinatario.indicadorInscricaoEstadual,
      input.destinatario.inscricaoEstadual
    ),

    valor_frete: resolverValorFrete(input.valorFrete ?? null),
    valor_seguro: "0",
    valor_total: input.valorTotal.toFixed(2),
    valor_produtos: input.valorTotal.toFixed(2),

    // LIMITAÇÃO CONHECIDA (achado F3 da auditoria de abrangência): o grupo
    // de dados da transportadora (nome_transportador/cnpj_transportador/
    // placa_veiculo/quantidade_volumes/especie_volumes/peso_bruto etc — tag
    // <transp> da NF-e 4.0) NÃO é mandado aqui, mesmo quando o orçamento tem
    // Orcamento.transportadoraId preenchido. Motivo: os nomes de campo exatos
    // exigidos pela Focus NFe pra esse grupo não foram confirmados contra a
    // doc oficial nesta rodada (mesmo cuidado que já levou outros mapeamentos
    // deste arquivo — ex: mapearItemNfePayload — a citar a doc consultada);
    // mandar campo errado arrisca rejeição silenciosa ou nome de campo
    // ignorado pela API. Só valor_frete foi corrigido. Se um dia isso for
    // implementado, os dados já existem em Orcamento.transportadoraId
    // (Transportadora.nome/documento/rntrc) — falta só confirmar o payload
    // exato em doc.focusnfe.com.br/reference/emitir_nfe e mapear aqui.

    items: input.itens.map((item) => mapearItemNfePayload(item)),
  };

  const url = `${BASE_URL[config.ambiente]}/v2/nfe?ref=${encodeURIComponent(input.referencia)}`;
  const resposta = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: autorizacaoBasica(config.token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await resposta.json().catch(() => ({}));

  if (resposta.status === 422) {
    return {
      status: "erro_autorizacao",
      mensagemErro: extrairMensagemDeErroValidacao(json) ?? "A Focus NFe rejeitou os dados enviados.",
    };
  }
  if (!resposta.ok) {
    throw new ErroFocusNfe(`Falha ao chamar a Focus NFe (HTTP ${resposta.status}).`, json);
  }

  const mapeada = mapearResposta(json as Record<string, unknown>);
  return {
    ...mapeada,
    caminhoXml: completarUrlArquivo(mapeada.caminhoXml, config.ambiente),
    caminhoDanfe: completarUrlArquivo(mapeada.caminhoDanfe, config.ambiente),
  };
}

export async function consultarNfe(
  config: ConfigFocusNfe,
  referencia: string
): Promise<RespostaFocusNfe> {
  const url = `${BASE_URL[config.ambiente]}/v2/nfe/${encodeURIComponent(referencia)}?completa=1`;
  const resposta = await fetch(url, {
    method: "GET",
    headers: { Authorization: autorizacaoBasica(config.token) },
  });

  const json = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    throw new ErroFocusNfe(`Falha ao consultar a Focus NFe (HTTP ${resposta.status}).`, json);
  }

  const mapeada = mapearResposta(json);
  return {
    ...mapeada,
    caminhoXml: completarUrlArquivo(mapeada.caminhoXml, config.ambiente),
    caminhoDanfe: completarUrlArquivo(mapeada.caminhoDanfe, config.ambiente),
  };
}

export { ErroFocusNfe };
