"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { randomBytes } from "node:crypto";
import { put, del } from "@vercel/blob";
import { exigirTokenBlobPrivado } from "@/lib/blob-assinado";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { resolverLimiteDesconto, type AlcadaParaResolucao } from "@/lib/alcada-aprovacao";
import { calcularItemOrcamento, recalcularTotalOrcamento } from "@/lib/orcamento-precificacao";
import { analisarPreflight } from "@/lib/preflight";
import { resolverOrigemPublica } from "@/lib/url-publica";
import {
  validarArquivoArte,
  extensaoArte,
  assinaturaBateComTipo,
  BYTES_ASSINATURA,
} from "@/lib/upload-validacao";
import {
  TRANSICOES_VALIDAS,
  ROTULOS_STATUS_ORCAMENTO,
  type StatusOrcamento,
} from "@/lib/orcamento-status";
import {
  verificarProntidaoFiscal,
  prepararNotificacaoNotaFiscal,
  resolverDadosFiscais,
  resolverCfop,
  type DadosFiscaisResolvidos,
} from "@/lib/nota-fiscal";
import {
  emitirNfe,
  consultarNfe,
  ErroFocusNfe,
  type AmbienteFocusNfe,
  type RespostaFocusNfe,
  type ItemNfe,
} from "@/lib/focus-nfe";
import { dispararEventoEmail } from "@/lib/email/webhook-email";
import { templateResponsavelNotaFiscal } from "@/lib/email/templates";
import { registrarAuditoria } from "@/lib/auditoria";
import { abrirApontamentoInicialSeNecessario } from "@/lib/apontamento-etapa";
import { formatoMoeda } from "@/lib/moeda";
import { dataInputParaUTC, dataHoraInputParaUTC, formatoInstanteReal } from "@/lib/data";
import {
  ETAPAS_ORCAMENTO,
  nomeCampoEtapaEm,
  nomeCampoEtapaResponsavel,
  type ChaveEtapaOrcamento,
} from "@/lib/orcamento-etapas";
import {
  validarContagemCor,
  normalizarRebobinamento,
  validarMaterialSubstratoOutro,
  validarCampoOutro,
} from "@/lib/orcamento-etiqueta";
import { parseJsonArray } from "@/lib/form-json";
import { ehConflitoDeSerializacao } from "@/lib/prisma-conflito";
import { calcularValorBase, calcularComissao } from "@/lib/comissao";
import {
  removerArquivo,
  resolverContextoArmazenamento,
  reservarEspaco,
  confirmarArquivo,
  cancelarReserva,
} from "@/lib/billing/armazenamento";
import { calcularPrevisaoAprovacaoPedido, gravarPrevisaoAprovacaoPedido } from "@/lib/pedido-aprovacao";
import { criarCustoAutomaticoComissao } from "@/lib/custo-pedido";
import { gerarContasReceberDaAprovacao, gerarContasReceberDaEmissaoNota } from "@/lib/condicao-pagamento";
import { calcularExposicaoCreditoCliente } from "@/lib/exposicao-credito-cliente";
import { lancarConsumoCreditoCliente } from "@/lib/credito-cliente";
import { saldoContaReceber } from "@/lib/baixa-financeira";
import { registrarCandidatosGangRun } from "@/lib/gang-run-servico";
import { resolverOpcoesNaAprovacao, descartarOpcoesAlternativas } from "@/lib/orcamento-opcoes";
import { UNIDADES_DIMENSAO, converterParaCm } from "@/lib/unidade-dimensao";
import { paraDecimal, type Dec } from "@/lib/pricing/decimal";
import { aplicarPisoDoPedido } from "@/lib/pricing";
import { montarDadosItemParaRecalculo, calcularDescontoHerdado } from "@/lib/orcamento-duplicar";

import { buscarAlcadasDesconto } from "./helpers";

// Achado A4 da auditoria de abrangência (Parte 6/Configurações) — usado por
// aplicarDescontoItemOrcamento (herança de desconto também usa
// buscarAlcadasDesconto, ver ./helpers).
const MENSAGEM_CONFLITO_CONCORRENTE =
  "Outra pessoa alterou este orçamento ao mesmo tempo — tente de novo.";

// Nunca confia na unidade que vem do formulário — validada contra as únicas
// 3 que existem (ver src/lib/unidade-dimensao.ts) antes de converter pra
// centímetro na fronteira (usada por adicionarItemOrcamento).
const unidadeDimensaoSchema = z.enum(UNIDADES_DIMENSAO);

// Sinaliza, de dentro de uma transação Serializable, que o orçamento já está
// no último item — usado só pra abortar a transação com uma mensagem amigável
// (ver removerItemOrcamento). Não é um erro de banco de verdade.
class ErroUltimoItemOrcamento extends Error {}

// Valores dos enums de etiqueta, usados só pra validar campo solto vindo de
// FormData (adicionarItemOrcamento/editarOrcamento) — o schema zod completo
// (usado no carrinho JSON de criarOrcamento) vive em src/app/orcamento/actions.ts.
const MATERIAL_SUBSTRATO_VALORES = [
  "PAPEL_TERMICO",
  "COUCHE_C_ROT",
  "BOPP_METALIZADO_ROT",
  "BOPP_BCO_PEROLIZADO",
  "BOPP_BCO_FOSCO",
  "BOPP_TRANSPARENTE",
  "L2_SEM_ADESIVO",
  "POLIETILENO_BRANCO",
  "POLIETILENO_TRANSPARENTE",
  "POLIESTER_BRANCO",
  "POLIESTER_TRANSPARENTE",
  "POLIESTER_CROMO_FOSCO",
  "ELETROSTATICO_SEM_COLA",
  "OUTRO",
] as const;
const TIPO_ADESIVO_VALORES = [
  "ACRILICO_20G",
  "ACRILICO_30G",
  "BORRACHA_20G",
  "BORRACHA_25G",
  "BORRACHA_30G",
  "BORRACHA_50G",
  "OUTRO",
] as const;
const SUPERFICIE_APLICACAO_VALORES = ["VIDRO", "PLASTICO", "METAL", "PAPEL", "PAPELAO", "OUTROS"] as const;
const TIPO_ROTULAGEM_VALORES = ["MANUAL", "AUTOMATICA"] as const;
const TIPO_SERRILHA_VALORES = ["SERRILHA", "MICRO_SERRILHA", "GAP", "OUTRO"] as const;
const TIPO_LAMINACAO_VALORES = ["BRILHO", "FOSCO", "OUTRO"] as const;
const TIPO_VERNIZ_VALORES = ["BRILHO", "FOSCO", "RIBBON", "OUTRO"] as const;

const hotStampingFormSchema = z
  .object({
    lado: z.enum(["ROTULO", "CONTRA_ROTULO"]),
    tipo: z.enum(["HOT", "COLD", "OUTRO"]),
    tipoOutro: z.string().max(60).nullable(),
    tipoEfeitoHotStamping: z.string().max(120).nullable(),
    medida: z.string().max(60).nullable(),
    cor: z.string().max(60).nullable(),
  })
  .refine((dados) => dados.tipo !== "OUTRO" || Boolean(dados.tipoOutro?.trim()), {
    message: 'Descreva o tipo quando escolher "Outro" como tipo de hot/cold stamping.',
  });

type EtiquetaParaGravar = {
  materialSubstrato: (typeof MATERIAL_SUBSTRATO_VALORES)[number] | null;
  materialSubstratoOutro: string | null;
  tipoAdesivo: (typeof TIPO_ADESIVO_VALORES)[number] | null;
  tipoAdesivoOutro: string | null;
  durabilidadeAdesivo: string | null;
  superficieAplicacao: (typeof SUPERFICIE_APLICACAO_VALORES)[number] | null;
  superficieAplicacaoOutro: string | null;
  formatoEtiqueta: string | null;
  coresRotulo: number | null;
  coresContraRotulo: number | null;
  embalagemQtdPorRolo: number | null;
  tubeteMedida: string | null;
  rotulagem: (typeof TIPO_ROTULAGEM_VALORES)[number] | null;
  serrilha: (typeof TIPO_SERRILHA_VALORES)[number] | null;
  serrilhaOutro: string | null;
  vernizRotuloTotal: boolean;
  vernizRotuloReserva: boolean;
  vernizRotuloTipo: (typeof TIPO_VERNIZ_VALORES)[number] | null;
  vernizRotuloTipoOutro: string | null;
  vernizContraRotuloTotal: boolean;
  vernizContraRotuloReserva: boolean;
  vernizContraRotuloTipo: (typeof TIPO_VERNIZ_VALORES)[number] | null;
  vernizContraRotuloTipoOutro: string | null;
  laminacaoRotulo: (typeof TIPO_LAMINACAO_VALORES)[number] | null;
  laminacaoRotuloOutro: string | null;
  laminacaoContraRotulo: (typeof TIPO_LAMINACAO_VALORES)[number] | null;
  laminacaoContraRotuloOutro: string | null;
  rebobinamento: number | null;
  hotStampings: z.infer<typeof hotStampingFormSchema>[];
};

type ResultadoEtiquetaFormData = { ok: true; etiqueta: EtiquetaParaGravar } | { ok: false; mensagem: string };

// Lê e valida os ~18 campos de etiqueta soltos no FormData (não JSON — mesmo
// padrão do resto deste arquivo) + a lista de hot stampings (essa sim vem
// como JSON num hidden field, é a única parte de tamanho variável). Usado
// por adicionarItemOrcamento e editarOrcamento.
function lerEtiquetaDoFormData(formData: FormData): ResultadoEtiquetaFormData {
  const campoTexto = (nome: string, max: number) =>
    String(formData.get(nome) || "").trim().slice(0, max) || null;
  const campoEnum = <T extends string>(nome: string, valores: readonly T[]): T | null => {
    const bruto = formData.get(nome);
    return typeof bruto === "string" && (valores as readonly string[]).includes(bruto) ? (bruto as T) : null;
  };
  const campoBooleano = (nome: string) => formData.get(nome) === "on" || formData.get(nome) === "true";
  const campoString = (nome: string): string | null => {
    const bruto = formData.get(nome);
    return typeof bruto === "string" ? bruto : null;
  };

  const materialSubstrato = campoEnum("materialSubstrato", MATERIAL_SUBSTRATO_VALORES);
  const materialSubstratoOutro = campoTexto("materialSubstratoOutro", 120);
  const validacaoOutro = validarMaterialSubstratoOutro(materialSubstrato, materialSubstratoOutro);
  if (!validacaoOutro.ok) return { ok: false, mensagem: validacaoOutro.mensagem };

  const tipoAdesivo = campoEnum("tipoAdesivo", TIPO_ADESIVO_VALORES);
  const tipoAdesivoOutro = campoTexto("tipoAdesivoOutro", 120);
  const validacaoTipoAdesivo = validarCampoOutro(
    tipoAdesivo,
    tipoAdesivoOutro,
    'Descreva o adesivo quando escolher "Outro" como tipo de adesivo.'
  );
  if (!validacaoTipoAdesivo.ok) return { ok: false, mensagem: validacaoTipoAdesivo.mensagem };

  const durabilidadeAdesivo = campoTexto("durabilidadeAdesivo", 120);

  const superficieAplicacao = campoEnum("superficieAplicacao", SUPERFICIE_APLICACAO_VALORES);
  const superficieAplicacaoOutro = campoTexto("superficieAplicacaoOutro", 120);
  const validacaoSuperficie = validarCampoOutro(
    superficieAplicacao,
    superficieAplicacaoOutro,
    'Descreva a superfície quando escolher "Outros" como superfície de aplicação.',
    "OUTROS"
  );
  if (!validacaoSuperficie.ok) return { ok: false, mensagem: validacaoSuperficie.mensagem };

  const serrilha = campoEnum("serrilha", TIPO_SERRILHA_VALORES);
  const serrilhaOutro = campoTexto("serrilhaOutro", 120);
  const validacaoSerrilha = validarCampoOutro(
    serrilha,
    serrilhaOutro,
    'Descreva a serrilha quando escolher "Outro" como serrilha.'
  );
  if (!validacaoSerrilha.ok) return { ok: false, mensagem: validacaoSerrilha.mensagem };

  const vernizRotuloTipo = campoEnum("vernizRotuloTipo", TIPO_VERNIZ_VALORES);
  const vernizRotuloTipoOutro = campoTexto("vernizRotuloTipoOutro", 120);
  const validacaoVernizRotulo = validarCampoOutro(
    vernizRotuloTipo,
    vernizRotuloTipoOutro,
    'Descreva o acabamento de verniz do rótulo quando escolher "Outro".'
  );
  if (!validacaoVernizRotulo.ok) return { ok: false, mensagem: validacaoVernizRotulo.mensagem };

  const vernizContraRotuloTipo = campoEnum("vernizContraRotuloTipo", TIPO_VERNIZ_VALORES);
  const vernizContraRotuloTipoOutro = campoTexto("vernizContraRotuloTipoOutro", 120);
  const validacaoVernizContraRotulo = validarCampoOutro(
    vernizContraRotuloTipo,
    vernizContraRotuloTipoOutro,
    'Descreva o acabamento de verniz do contra-rótulo quando escolher "Outro".'
  );
  if (!validacaoVernizContraRotulo.ok) return { ok: false, mensagem: validacaoVernizContraRotulo.mensagem };

  const laminacaoRotulo = campoEnum("laminacaoRotulo", TIPO_LAMINACAO_VALORES);
  const laminacaoRotuloOutro = campoTexto("laminacaoRotuloOutro", 120);
  const validacaoLaminacaoRotulo = validarCampoOutro(
    laminacaoRotulo,
    laminacaoRotuloOutro,
    'Descreva a laminação do rótulo quando escolher "Outro".'
  );
  if (!validacaoLaminacaoRotulo.ok) return { ok: false, mensagem: validacaoLaminacaoRotulo.mensagem };

  const laminacaoContraRotulo = campoEnum("laminacaoContraRotulo", TIPO_LAMINACAO_VALORES);
  const laminacaoContraRotuloOutro = campoTexto("laminacaoContraRotuloOutro", 120);
  const validacaoLaminacaoContraRotulo = validarCampoOutro(
    laminacaoContraRotulo,
    laminacaoContraRotuloOutro,
    'Descreva a laminação do contra-rótulo quando escolher "Outro".'
  );
  if (!validacaoLaminacaoContraRotulo.ok)
    return { ok: false, mensagem: validacaoLaminacaoContraRotulo.mensagem };

  const coresRotuloResult = validarContagemCor(campoString("coresRotulo"), "Cores rótulo");
  if (!coresRotuloResult.ok) return { ok: false, mensagem: coresRotuloResult.mensagem };
  const coresContraRotuloResult = validarContagemCor(campoString("coresContraRotulo"), "Cores contra-rótulo");
  if (!coresContraRotuloResult.ok) return { ok: false, mensagem: coresContraRotuloResult.mensagem };
  const embalagemQtdResult = validarContagemCor(campoString("embalagemQtdPorRolo"), "Quantidade por rolo");
  if (!embalagemQtdResult.ok) return { ok: false, mensagem: embalagemQtdResult.mensagem };
  const rebobinamentoResult = normalizarRebobinamento(campoString("rebobinamento"));
  if (!rebobinamentoResult.ok) return { ok: false, mensagem: rebobinamentoResult.mensagem };

  const hotStampingsParsed = parseJsonArray(formData.get("hotStampingsJson"), hotStampingFormSchema, {
    max: 20,
  });
  if (!hotStampingsParsed.ok) return { ok: false, mensagem: hotStampingsParsed.mensagem };

  return {
    ok: true,
    etiqueta: {
      materialSubstrato,
      materialSubstratoOutro,
      tipoAdesivo,
      tipoAdesivoOutro,
      durabilidadeAdesivo,
      superficieAplicacao,
      superficieAplicacaoOutro,
      formatoEtiqueta: campoTexto("formatoEtiqueta", 120),
      coresRotulo: coresRotuloResult.valor,
      coresContraRotulo: coresContraRotuloResult.valor,
      embalagemQtdPorRolo: embalagemQtdResult.valor,
      tubeteMedida: campoTexto("tubeteMedida", 60),
      rotulagem: campoEnum("rotulagem", TIPO_ROTULAGEM_VALORES),
      serrilha,
      serrilhaOutro,
      vernizRotuloTotal: campoBooleano("vernizRotuloTotal"),
      vernizRotuloReserva: campoBooleano("vernizRotuloReserva"),
      vernizRotuloTipo,
      vernizRotuloTipoOutro,
      vernizContraRotuloTotal: campoBooleano("vernizContraRotuloTotal"),
      vernizContraRotuloReserva: campoBooleano("vernizContraRotuloReserva"),
      vernizContraRotuloTipo,
      vernizContraRotuloTipoOutro,
      laminacaoRotulo,
      laminacaoRotuloOutro,
      laminacaoContraRotulo,
      laminacaoContraRotuloOutro,
      rebobinamento: rebobinamentoResult.valor,
      hotStampings: hotStampingsParsed.data,
    },
  };
}

export type EditarOrcamentoResult = { ok: boolean; mensagem: string };

// Edita UM item específico do orçamento (não mais "o item", já que um orçamento
// pode ter vários — ver plano de multi-item). O total do orçamento é sempre
// recalculado como soma de TODOS os itens, não só do editado.
export async function editarOrcamento(
  _estadoAnterior: EditarOrcamentoResult | null,
  formData: FormData
): Promise<EditarOrcamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoId = String(formData.get("orcamentoId"));
  const orcamentoItemId = String(formData.get("orcamentoItemId"));
  const quantidade = Number(formData.get("quantidade"));
  const larguraCm = formData.get("larguraCm") ? Number(formData.get("larguraCm")) : null;
  const alturaCm = formData.get("alturaCm") ? Number(formData.get("alturaCm")) : null;
  // Achado A11 — mesmo padrão de larguraCm/alturaCm acima:
  // EditarOrcamentoForm.tsx já converte pra cm no client antes de mandar
  // (campo hidden). Ao contrário de profundidadeCm/espessuraMm abaixo, ESTA
  // passa por calcularItemOrcamento (motor de nesting), logo abaixo.
  const larguraPlanificadaCm = formData.get("larguraPlanificadaCm")
    ? Number(formData.get("larguraPlanificadaCm"))
    : null;
  const alturaPlanificadaCm = formData.get("alturaPlanificadaCm")
    ? Number(formData.get("alturaPlanificadaCm"))
    : null;
  // Achado F7 — mesmo padrão de larguraCm/alturaCm acima: EditarOrcamentoForm.tsx
  // já converte pra cm/mm no client antes de mandar (campo hidden). Nunca
  // passa por calcularItemOrcamento (motor de preço) — só gravado direto no
  // update abaixo.
  const profundidadeCm = formData.get("profundidadeCm") ? Number(formData.get("profundidadeCm")) : null;
  const espessuraMm = formData.get("espessuraMm") ? Number(formData.get("espessuraMm")) : null;
  // Limites iguais aos de itemEntradaSchema (orcamento/actions.ts), que
  // criarOrcamento já aplica — editarOrcamento/adicionarItemOrcamento não
  // usavam zod aqui e aceitavam string de qualquer tamanho. Com
  // serverActions.bodySizeLimit em 25mb (por causa do upload de arte), isso
  // permitia gravar dezenas de MB de texto numa única linha de orçamento.
  const cores = String(formData.get("cores") || "").slice(0, 60);
  const acabamento = String(formData.get("acabamento") || "").slice(0, 200);
  // Achado B6 — texto livre que sobrepõe o nome do catálogo no PDF/link
  // público quando preenchido (ver src/lib/pdf/mapear-dados.ts). Puramente
  // descritivo, nunca passa por calcularItemOrcamento — só lido do FormData e
  // gravado direto, mesmo caminho de `acabamento` acima.
  const descricaoLivre = String(formData.get("descricaoLivre") || "").trim().slice(0, 500);
  const corFrente = formData.get("corFrente") ? Number(formData.get("corFrente")) : null;
  const corVerso = formData.get("corVerso") ? Number(formData.get("corVerso")) : null;
  // Motor Flexografia — deliberadamente separado de corFrente/corVerso (ver
  // src/lib/orcamento-precificacao.ts).
  const numeroCoresFlexo = formData.get("numeroCoresFlexo")
    ? Number(formData.get("numeroCoresFlexo"))
    : null;
  // Motor Digital — opcional (default 1 no motor se ausente).
  const numeroCliques = formData.get("numeroCliques") ? Number(formData.get("numeroCliques")) : null;
  // Motores Serigrafia/Sublimação/Estampagem a quente (compartilham este campo).
  const numeroSetups = formData.get("numeroSetups") ? Number(formData.get("numeroSetups")) : null;
  // Motor Bordado (achado A4) — nº de pontos da arte deste pedido.
  const numeroPontos = formData.get("numeroPontos") ? Number(formData.get("numeroPontos")) : null;
  // Motor Tempo de máquina (achado A6) — a gráfica escolhe a base na máquina.
  const tempoEstimadoMin = formData.get("tempoEstimadoMin")
    ? Number(formData.get("tempoEstimadoMin"))
    : null;
  const metrosCorte = formData.get("metrosCorte") ? Number(formData.get("metrosCorte")) : null;
  // Acabamento cobrado por hora (ex: instalação, criação de arte) — não é
  // model-gated, independente do modeloCalculo do item.
  const horasEstimadas = formData.get("horasEstimadas") ? Number(formData.get("horasEstimadas")) : null;
  // Achado B4 — prazo estimado de entrega EM DIAS, específico deste item
  // (complementa Orcamento.prazoEntregaEstimadoDias único no cabeçalho).
  const prazoEstimadoDias = formData.get("prazoEstimadoDias") ? Number(formData.get("prazoEstimadoDias")) : null;
  // Motor de clichê de etiqueta (só M2 com ConfiguracaoClicheEtiqueta) — ver
  // src/lib/orcamento-precificacao.ts.
  const papelId = String(formData.get("papelId") || "").trim() || null;
  const quantidadeCores = formData.get("quantidadeCores")
    ? Number(formData.get("quantidadeCores"))
    : null;
  const custoFaca = formData.get("custoFaca") ? Number(formData.get("custoFaca")) : null;
  const custoFrete = formData.get("custoFrete") ? Number(formData.get("custoFrete")) : null;
  // Motor Offset (achado N8) — gramatura escolhida NESTE orçamento,
  // sobrepondo ItemGrafica.gramaturaGm2 do produto; ausente = usa a
  // gramatura fixa do produto, comportamento de sempre.
  const gramaturaGm2 = formData.get("gramaturaGm2") ? Number(formData.get("gramaturaGm2")) : null;
  // Motor Revenda/terceirização (achado A12) — override opcional, POR
  // ORÇAMENTO, do custo de aquisição; ausente = motor cai no precoCompra do
  // catálogo (ver src/lib/pricing/carregar.ts).
  const custoAquisicaoUnitario = formData.get("custoAquisicaoUnitario")
    ? Number(formData.get("custoAquisicaoUnitario"))
    : null;
  // "Material fornecido pelo cliente" (achado B7) — checkbox, não número:
  // sem exigir presença no FormData, ausente = desmarcado = false.
  const materialFornecidoPeloCliente = formData.get("materialFornecidoPeloCliente") === "on";

  if (!quantidade || quantidade <= 0 || quantidade > 1_000_000) {
    return { ok: false, mensagem: "Informe uma quantidade válida (até 1.000.000 unidades)." };
  }

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
    // opcaoId: null — esta action só edita a opção-base ("Opção A"). Um item
    // de opção alternativa (ver model OrcamentoOpcao no schema.prisma) não é
    // editável incrementalmente; a alternativa inteira é removida e recriada
    // (ver src/app/orcamento/[id]/opcoes.actions.ts).
    include: {
      itens: { where: { opcaoId: null }, include: { itemGrafica: true } },
      // Achado A7 — margemPadraoOverride é propriedade do CLIENTE, constante
      // em todo item deste orçamento (ver DadosItemOrcamento.margemLucroOverride).
      cliente: { select: { margemPadraoOverride: true } },
    },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  // Só dá pra editar enquanto ainda é rascunho — preserva a integridade do
  // que já foi enviado/decidido pelo cliente.
  if (orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível editar um orçamento em rascunho." };
  }
  const margemLucroOverride =
    orcamento.cliente.margemPadraoOverride !== null ? Number(orcamento.cliente.margemPadraoOverride) : null;

  const item = orcamento.itens.find((i) => i.id === orcamentoItemId);
  if (!item) {
    return { ok: false, mensagem: "Item do orçamento não encontrado." };
  }

  // Produto não muda em editarOrcamento, então dá pra saber se o motor é
  // avançado (M2/OFFSET, único caso em que acabamentoIds se aplica) antes de
  // chamar calcularItemOrcamento.
  const acabamentoIds =
    item.modeloCalculo !== "SIMPLES"
      ? formData.getAll("acabamentoIds").map(String).filter(Boolean).slice(0, 20)
      : [];

  const resultado = await calcularItemOrcamento(item.itemGrafica, usuario.graficaId, {
    quantidade,
    larguraCm,
    alturaCm,
    larguraPlanificadaCm,
    alturaPlanificadaCm,
    corFrente,
    corVerso,
    numeroCoresFlexo,
    numeroCliques,
    numeroSetups,
    numeroPontos,
    tempoEstimadoMin,
    metrosCorte,
    horasEstimadas,
    acabamentoIds,
    papelId,
    quantidadeCores,
    custoFaca,
    custoFrete,
    gramaturaGm2,
    custoAquisicaoUnitario,
    materialFornecidoPeloCliente,
    margemLucroOverride,
  });
  if (!resultado.ok) {
    return { ok: false, mensagem: resultado.mensagem };
  }

  // Achado de auditoria pré-lançamento (2026-08-15): esta action sempre
  // sobrescrevia precoUnitario/precoTotal com o preço CHEIO recalculado,
  // mesmo em itens com desconto negociado ativo — silenciosamente cobrando
  // o preço cheio enquanto descontoTipo/descontoValor continuavam gravados
  // como se o desconto ainda estivesse valendo (UI mostrava "15% de
  // desconto" com o item já cobrando 100%). Pior ainda: precoSugeridoUnitario
  // (a baseline usada por "voltar ao preço sugerido" em
  // aplicarDescontoItemOrcamento) nunca era atualizado, então remover um
  // desconto depois de editar quantidade/medida podia cobrar um valor bem
  // abaixo do correto. Em vez de tentar reaplicar o desconto sozinho contra
  // a nova base (arriscaria pular a checagem de aprovação/piso de custo),
  // a escolha segura é limpar o desconto junto com o recálculo — o vendedor
  // decide explicitamente se quer negociar de novo contra o preço atual.
  const tinhaDescontoAtivo = item.descontoTipo !== null;

  // Produto não muda em editarOrcamento (só quantidade/medida/cores), então
  // modeloCalculo vem do item já existente, não de `resultado`.
  let etiqueta: EtiquetaParaGravar | null = null;
  if (item.modeloCalculo === "M2") {
    const etiquetaResult = lerEtiquetaDoFormData(formData);
    if (!etiquetaResult.ok) {
      return { ok: false, mensagem: etiquetaResult.mensagem };
    }
    etiqueta = etiquetaResult.etiqueta;
  }

  // Isolamento Serializable + total recalculado por agregado DENTRO da
  // transação (não somado em JS a partir da leitura de `orcamento.itens` feita
  // acima, que já pode estar desatualizada) — evita tanto a corrida de duas
  // edições concorrentes em itens diferentes do mesmo orçamento quanto a
  // imprecisão de somar Decimal via Number() (o SUM roda no Postgres).
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.orcamentoItem.update({
          where: { id: orcamentoItemId },
          data: {
            quantidade,
            larguraCm,
            alturaCm,
            larguraPlanificadaCm,
            alturaPlanificadaCm,
            profundidadeCm,
            espessuraMm,
            cores: cores || null,
            acabamento: acabamento || null,
            descricaoLivre: descricaoLivre || null,
            precoUnitario: resultado.precoUnitario,
            precoTotal: resultado.precoTotal,
            // Baseline sempre fresca — precoSugeridoUnitario nunca fica presa
            // ao valor de quando o item foi criado (ver comentário acima).
            precoSugeridoUnitario: resultado.precoUnitario,
            // Desconto negociado não sobrevive a uma edição de preço — ver
            // comentário acima. Idempotente quando já era null.
            descontoTipo: null,
            descontoValor: null,
            motivoDesconto: null,
            aprovadoPorId: null,
            corFrente: resultado.corFrente,
            corVerso: resultado.corVerso,
            numeroCoresFlexo: resultado.numeroCoresFlexo,
            numeroCliques: resultado.numeroCliques,
            numeroSetups: resultado.numeroSetups,
            prazoEstimadoDias: prazoEstimadoDias,
            numeroPontos: resultado.numeroPontos,
            tempoEstimadoMin: resultado.tempoEstimadoMin,
            metrosCorte: resultado.metrosCorte,
            horasEstimadas: resultado.horasEstimadas,
            custoAquisicaoUnitario: resultado.custoAquisicaoUnitario,
            custoFaca: resultado.custoFaca,
            materialFornecidoPeloCliente: resultado.materialFornecidoPeloCliente,
            breakdown: resultado.breakdown ?? undefined,
          },
        });

        // Lista pequena, sem histórico a preservar — mesmo padrão de
        // orcamentoItemHotStamping logo abaixo: mais simples apagar tudo e
        // recriar do zero a partir do resultado recalculado do que diffar
        // item a item.
        if (item.modeloCalculo !== "SIMPLES") {
          await tx.orcamentoItemAcabamento.deleteMany({ where: { orcamentoItemId } });
          if (resultado.acabamentos.length > 0) {
            await tx.orcamentoItemAcabamento.createMany({
              data: resultado.acabamentos.map((a) => ({
                orcamentoItemId,
                itemGraficaId: a.itemGraficaId,
                qtdBase: a.qtdBase,
                custoCalculado: a.custoCalculado,
              })),
            });
          }
        }

        // upsert (não create): a mesma linha é atualizada se o vendedor trocar
        // o papel/cores num item que já tinha essa config, nunca duplica.
        // Ausente quando o produto não tem ConfiguracaoClicheEtiqueta —
        // resultado.precificacaoEtiqueta já vem null nesse caso.
        if (resultado.precificacaoEtiqueta) {
          await tx.orcamentoItemPrecificacaoEtiqueta.upsert({
            where: { orcamentoItemId },
            create: {
              orcamentoItemId,
              papelId: resultado.precificacaoEtiqueta.papelId,
              quantidadeCores: resultado.precificacaoEtiqueta.quantidadeCores,
              custoClicheCalculado: resultado.precificacaoEtiqueta.custoClicheCalculado,
              custoFaca: resultado.precificacaoEtiqueta.custoFaca,
              custoFrete: resultado.precificacaoEtiqueta.custoFrete,
            },
            update: {
              papelId: resultado.precificacaoEtiqueta.papelId,
              quantidadeCores: resultado.precificacaoEtiqueta.quantidadeCores,
              custoClicheCalculado: resultado.precificacaoEtiqueta.custoClicheCalculado,
              custoFaca: resultado.precificacaoEtiqueta.custoFaca,
              custoFrete: resultado.precificacaoEtiqueta.custoFrete,
            },
          });
        }

        // Achado N4 (correção de gap encontrado durante a revisão do N8) —
        // o motor Digital já calculava o preço certo a partir de
        // dados.papelId desde que o achado N4 foi construído, mas nunca
        // persistia OrcamentoItemPrecificacaoDigital em nenhum fluxo de
        // escrita — a tela de edição sempre reabria com o papel em branco.
        // Mesmo padrão upsert de precificacaoEtiqueta/precificacaoOffset.
        if (resultado.precificacaoDigital) {
          await tx.orcamentoItemPrecificacaoDigital.upsert({
            where: { orcamentoItemId },
            create: {
              orcamentoItemId,
              papelId: resultado.precificacaoDigital.papelId,
            },
            update: {
              papelId: resultado.precificacaoDigital.papelId,
            },
          });
        }

        // Achado N8 — upsert (não create) porque o vendedor pode reabrir a
        // edição de um item OFFSET que já tinha um override e trocar de
        // novo o papel/gramatura, mesmo padrão de precificacaoEtiqueta
        // acima. Só TOCA a tabela quando há override de verdade (nunca uma
        // query condicional pra todo item OFFSET sem override, que é a
        // esmagadora maioria) — LIMITAÇÃO conhecida: se o vendedor limpar um
        // override já salvo (volta a usar o papel/gramatura do produto), o
        // PREÇO recalcula certo (dados.papelId/gramaturaGm2 vêm null,
        // contexto.offset cai nos valores do produto), mas a linha antiga
        // fica órfã no banco e a tela de edição pode reabrir mostrando o
        // papel/gramatura antigos pré-preenchidos — aceito de propósito
        // (uso real de OFFSET é ~0 hoje) em vez de forçar toda edição de
        // item OFFSET a tocar esta tabela.
        if (resultado.precificacaoOffset) {
          await tx.orcamentoItemPrecificacaoOffset.upsert({
            where: { orcamentoItemId },
            create: {
              orcamentoItemId,
              papelId: resultado.precificacaoOffset.papelId,
              gramaturaGm2: resultado.precificacaoOffset.gramaturaGm2,
            },
            update: {
              papelId: resultado.precificacaoOffset.papelId,
              gramaturaGm2: resultado.precificacaoOffset.gramaturaGm2,
            },
          });
        }

        // upsert (não create) porque um item M2 criado antes desta feature
        // pode ainda não ter linha de etiqueta.
        if (item.modeloCalculo === "M2" && etiqueta) {
          const dadosEtiqueta = {
            materialSubstrato: etiqueta.materialSubstrato,
            materialSubstratoOutro: etiqueta.materialSubstratoOutro,
            tipoAdesivo: etiqueta.tipoAdesivo,
            tipoAdesivoOutro: etiqueta.tipoAdesivoOutro,
            durabilidadeAdesivo: etiqueta.durabilidadeAdesivo,
            superficieAplicacao: etiqueta.superficieAplicacao,
            superficieAplicacaoOutro: etiqueta.superficieAplicacaoOutro,
            formatoEtiqueta: etiqueta.formatoEtiqueta,
            coresRotulo: etiqueta.coresRotulo,
            coresContraRotulo: etiqueta.coresContraRotulo,
            embalagemQtdPorRolo: etiqueta.embalagemQtdPorRolo,
            tubeteMedida: etiqueta.tubeteMedida,
            rotulagem: etiqueta.rotulagem,
            serrilha: etiqueta.serrilha,
            serrilhaOutro: etiqueta.serrilhaOutro,
            vernizRotuloTotal: etiqueta.vernizRotuloTotal,
            vernizRotuloReserva: etiqueta.vernizRotuloReserva,
            vernizRotuloTipo: etiqueta.vernizRotuloTipo,
            vernizRotuloTipoOutro: etiqueta.vernizRotuloTipoOutro,
            vernizContraRotuloTotal: etiqueta.vernizContraRotuloTotal,
            vernizContraRotuloReserva: etiqueta.vernizContraRotuloReserva,
            vernizContraRotuloTipo: etiqueta.vernizContraRotuloTipo,
            vernizContraRotuloTipoOutro: etiqueta.vernizContraRotuloTipoOutro,
            laminacaoRotulo: etiqueta.laminacaoRotulo,
            laminacaoRotuloOutro: etiqueta.laminacaoRotuloOutro,
            laminacaoContraRotulo: etiqueta.laminacaoContraRotulo,
            laminacaoContraRotuloOutro: etiqueta.laminacaoContraRotuloOutro,
            rebobinamento: etiqueta.rebobinamento,
          };
          const etiquetaRow = await tx.orcamentoItemEtiqueta.upsert({
            where: { orcamentoItemId },
            create: { orcamentoItemId, ...dadosEtiqueta },
            update: dadosEtiqueta,
          });

          // Lista pequena, sem histórico a preservar (diferente de
          // VarianteMateriaPrima) — mais simples apagar tudo e recriar do
          // zero a partir do array enviado do que diffar item a item.
          await tx.orcamentoItemHotStamping.deleteMany({
            where: { orcamentoItemEtiquetaId: etiquetaRow.id },
          });
          if (etiqueta.hotStampings.length > 0) {
            await tx.orcamentoItemHotStamping.createMany({
              data: etiqueta.hotStampings.map((h) => ({
                orcamentoItemEtiquetaId: etiquetaRow.id,
                lado: h.lado,
                tipo: h.tipo,
                tipoOutro: h.tipoOutro || null,
                tipoEfeitoHotStamping: h.tipoEfeitoHotStamping || null,
                medida: h.medida || null,
                cor: h.cor || null,
              })),
            });
          }
        }

        // opcaoId: null — total da opção-base é sempre só a soma dos itens
        // dela; itens de opções alternativas (ver OrcamentoOpcao) têm seu
        // próprio total, calculado à parte (ver opcoes.actions.ts). Achado
        // N3 — recalcularTotalOrcamento já aplica o piso de pedido (uma vez
        // sobre a soma, não por item) antes de gravar.
        await recalcularTotalOrcamento(tx, orcamentoId, usuario.graficaId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (erro) {
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO_CONCORRENTE };
    }
    throw erro;
  }

  revalidatePath(`/orcamento/${orcamentoId}`);
  revalidatePath("/orcamento");

  return {
    ok: true,
    mensagem: tinhaDescontoAtivo
      ? "Item atualizado com sucesso! O desconto negociado foi removido porque o preço mudou — aplique de novo se ainda for o caso."
      : "Item atualizado com sucesso!",
  };
}

export type AdicionarItemResult = { ok: boolean; mensagem: string };

export async function adicionarItemOrcamento(
  _estadoAnterior: AdicionarItemResult | null,
  formData: FormData
): Promise<AdicionarItemResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoId = String(formData.get("orcamentoId"));
  const itemGraficaId = String(formData.get("itemGraficaId"));
  const quantidade = Number(formData.get("quantidade"));
  // Valor DIGITADO na unidade abaixo — NÃO necessariamente centímetro (ver
  // SeletorItemOrcamento.tsx). Validado e convertido pra cm mais abaixo,
  // antes de calcularItemOrcamento.
  const larguraBruta = formData.get("largura") ? Number(formData.get("largura")) : null;
  const alturaBruta = formData.get("altura") ? Number(formData.get("altura")) : null;
  // Achado A11 — mesma convenção de largura/altura acima: dimensão do
  // desenvolvimento da faca (planificação), DIGITADA na unidade abaixo
  // (convertida pra cm mais abaixo), opcional. Ao contrário de
  // profundidade/espessura abaixo, ESTA entra no motor de nesting.
  const larguraPlanificadaBruta = formData.get("larguraPlanificada")
    ? Number(formData.get("larguraPlanificada"))
    : null;
  const alturaPlanificadaBruta = formData.get("alturaPlanificada")
    ? Number(formData.get("alturaPlanificada"))
    : null;
  // Achado F7 — mesma convenção de largura/altura acima: profundidade
  // DIGITADA na unidade abaixo (convertida pra cm mais abaixo), espessura
  // SEMPRE em mm (nunca passa pela conversão de unidade).
  const profundidadeBruta = formData.get("profundidade") ? Number(formData.get("profundidade")) : null;
  const espessuraMm = formData.get("espessuraMm") ? Number(formData.get("espessuraMm")) : null;
  // Limites iguais aos de itemEntradaSchema (orcamento/actions.ts), que
  // criarOrcamento já aplica — editarOrcamento/adicionarItemOrcamento não
  // usavam zod aqui e aceitavam string de qualquer tamanho. Com
  // serverActions.bodySizeLimit em 25mb (por causa do upload de arte), isso
  // permitia gravar dezenas de MB de texto numa única linha de orçamento.
  const cores = String(formData.get("cores") || "").slice(0, 60);
  const acabamento = String(formData.get("acabamento") || "").slice(0, 200);
  // Achado B6 — texto livre que sobrepõe o nome do catálogo no PDF/link
  // público quando preenchido (ver src/lib/pdf/mapear-dados.ts). Puramente
  // descritivo, nunca passa por calcularItemOrcamento — só lido do FormData e
  // gravado direto, mesmo caminho de `acabamento` acima.
  const descricaoLivre = String(formData.get("descricaoLivre") || "").trim().slice(0, 500);
  const acabamentoIds = formData.getAll("acabamentoIds").map(String).filter(Boolean).slice(0, 20);
  const corFrente = formData.get("corFrente") ? Number(formData.get("corFrente")) : null;
  const corVerso = formData.get("corVerso") ? Number(formData.get("corVerso")) : null;
  // Motor Flexografia — deliberadamente separado de corFrente/corVerso (ver
  // src/lib/orcamento-precificacao.ts).
  const numeroCoresFlexo = formData.get("numeroCoresFlexo")
    ? Number(formData.get("numeroCoresFlexo"))
    : null;
  // Motor Digital — opcional (default 1 no motor se ausente).
  const numeroCliques = formData.get("numeroCliques") ? Number(formData.get("numeroCliques")) : null;
  // Motores Serigrafia/Sublimação/Estampagem a quente (compartilham este campo).
  const numeroSetups = formData.get("numeroSetups") ? Number(formData.get("numeroSetups")) : null;
  // Motor Bordado (achado A4) — nº de pontos da arte deste pedido.
  const numeroPontos = formData.get("numeroPontos") ? Number(formData.get("numeroPontos")) : null;
  // Motor Tempo de máquina (achado A6) — a gráfica escolhe a base na máquina.
  const tempoEstimadoMin = formData.get("tempoEstimadoMin")
    ? Number(formData.get("tempoEstimadoMin"))
    : null;
  const metrosCorte = formData.get("metrosCorte") ? Number(formData.get("metrosCorte")) : null;
  // Acabamento cobrado por hora (ex: instalação, criação de arte) — não é
  // model-gated, independente do modeloCalculo do item.
  const horasEstimadas = formData.get("horasEstimadas") ? Number(formData.get("horasEstimadas")) : null;
  // Achado B4 — prazo estimado de entrega EM DIAS, específico deste item
  // (complementa Orcamento.prazoEntregaEstimadoDias único no cabeçalho).
  const prazoEstimadoDias = formData.get("prazoEstimadoDias") ? Number(formData.get("prazoEstimadoDias")) : null;
  // Motor de clichê de etiqueta (só M2 com ConfiguracaoClicheEtiqueta) — ver
  // src/lib/orcamento-precificacao.ts.
  const papelId = String(formData.get("papelId") || "").trim() || null;
  const quantidadeCores = formData.get("quantidadeCores")
    ? Number(formData.get("quantidadeCores"))
    : null;
  const custoFaca = formData.get("custoFaca") ? Number(formData.get("custoFaca")) : null;
  const custoFrete = formData.get("custoFrete") ? Number(formData.get("custoFrete")) : null;
  // Motor Offset (achado N8) — gramatura escolhida NESTE orçamento,
  // sobrepondo ItemGrafica.gramaturaGm2 do produto; ausente = usa a
  // gramatura fixa do produto, comportamento de sempre.
  const gramaturaGm2 = formData.get("gramaturaGm2") ? Number(formData.get("gramaturaGm2")) : null;
  // Motor Revenda/terceirização (achado A12) — override opcional, POR
  // ORÇAMENTO, do custo de aquisição; ausente = motor cai no precoCompra do
  // catálogo (ver src/lib/pricing/carregar.ts).
  const custoAquisicaoUnitario = formData.get("custoAquisicaoUnitario")
    ? Number(formData.get("custoAquisicaoUnitario"))
    : null;
  // "Material fornecido pelo cliente" (achado B7) — checkbox, não número:
  // sem exigir presença no FormData, ausente = desmarcado = false.
  const materialFornecidoPeloCliente = formData.get("materialFornecidoPeloCliente") === "on";

  if (!itemGraficaId || !quantidade || quantidade <= 0 || quantidade > 1_000_000) {
    return { ok: false, mensagem: "Escolha um produto e uma quantidade válida (até 1.000.000 unidades)." };
  }

  // Nunca confia na unidade vinda do formulário — precisa ser uma das 3 que
  // existem antes de converter pra cm.
  const unidadeParsed = unidadeDimensaoSchema.safeParse(formData.get("unidadeDimensao"));
  if (!unidadeParsed.success) {
    return { ok: false, mensagem: "Unidade de medida inválida." };
  }
  const unidadeDimensao = unidadeParsed.data;
  const larguraCm = larguraBruta !== null ? converterParaCm(larguraBruta, unidadeDimensao) : null;
  const alturaCm = alturaBruta !== null ? converterParaCm(alturaBruta, unidadeDimensao) : null;
  // Achado A11 — mesma conversão de largura/altura acima pra dimensão
  // planificada.
  const larguraPlanificadaCm =
    larguraPlanificadaBruta !== null ? converterParaCm(larguraPlanificadaBruta, unidadeDimensao) : null;
  const alturaPlanificadaCm =
    alturaPlanificadaBruta !== null ? converterParaCm(alturaPlanificadaBruta, unidadeDimensao) : null;
  // Achado F7 — mesma conversão de largura/altura acima pra profundidade;
  // espessuraMm já chega em mm. Nenhum dos dois vai pro motor de preço.
  const profundidadeCm =
    profundidadeBruta !== null ? converterParaCm(profundidadeBruta, unidadeDimensao) : null;

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
    // Achado A7 — margemPadraoOverride é propriedade do CLIENTE, constante
    // em todo item deste orçamento (ver DadosItemOrcamento.margemLucroOverride).
    include: { cliente: { select: { margemPadraoOverride: true } } },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  if (orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível adicionar itens a um orçamento em rascunho." };
  }
  const margemLucroOverride =
    orcamento.cliente.margemPadraoOverride !== null ? Number(orcamento.cliente.margemPadraoOverride) : null;

  const itemGrafica = await prisma.itemGrafica.findFirst({
    where: {
      id: itemGraficaId,
      graficaId: usuario.graficaId,
      ativo: true,
      precoVenda: { not: null },
    },
  });
  if (!itemGrafica || !itemGrafica.precoVenda) {
    return { ok: false, mensagem: "Produto ou serviço não encontrado." };
  }

  const resultado = await calcularItemOrcamento(itemGrafica, usuario.graficaId, {
    quantidade,
    larguraCm,
    alturaCm,
    larguraPlanificadaCm,
    alturaPlanificadaCm,
    corFrente,
    corVerso,
    numeroCoresFlexo,
    numeroCliques,
    numeroSetups,
    numeroPontos,
    tempoEstimadoMin,
    metrosCorte,
    horasEstimadas,
    acabamentoIds,
    papelId,
    quantidadeCores,
    custoFaca,
    custoFrete,
    gramaturaGm2,
    custoAquisicaoUnitario,
    materialFornecidoPeloCliente,
    margemLucroOverride,
  });
  if (!resultado.ok) {
    return { ok: false, mensagem: resultado.mensagem };
  }

  // Etiqueta não entra na conta de preço (ver src/lib/pricing/m2.ts) — só
  // relevante/gravada quando o item é M2 (flexografia).
  let etiqueta: EtiquetaParaGravar | null = null;
  if (resultado.modeloCalculo === "M2") {
    const etiquetaResult = lerEtiquetaDoFormData(formData);
    if (!etiquetaResult.ok) {
      return { ok: false, mensagem: etiquetaResult.mensagem };
    }
    etiqueta = etiquetaResult.etiqueta;
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.orcamentoItem.create({
          data: {
            orcamentoId,
            itemGraficaId: itemGrafica.id,
            quantidade,
            larguraCm,
            alturaCm,
            larguraPlanificadaCm,
            alturaPlanificadaCm,
            profundidadeCm,
            espessuraMm,
            unidadeDimensao,
            cores: cores || null,
            acabamento: acabamento || null,
            descricaoLivre: descricaoLivre || null,
            precoUnitario: resultado.precoUnitario,
            precoTotal: resultado.precoTotal,
            // Preço sugerido pelo motor no momento da criação — nunca editado
            // depois de gravado (ver fase-custo-real.md §2.4). Igual a
            // precoUnitario nesta primeira gravação; só diverge quando um
            // desconto é aplicado depois via aplicarDescontoItemOrcamento.
            precoSugeridoUnitario: resultado.precoUnitario,
            modeloCalculo: resultado.modeloCalculo,
            corFrente: resultado.corFrente,
            corVerso: resultado.corVerso,
            numeroCoresFlexo: resultado.numeroCoresFlexo,
            numeroCliques: resultado.numeroCliques,
            numeroSetups: resultado.numeroSetups,
            prazoEstimadoDias: prazoEstimadoDias,
            numeroPontos: resultado.numeroPontos,
            tempoEstimadoMin: resultado.tempoEstimadoMin,
            metrosCorte: resultado.metrosCorte,
            horasEstimadas: resultado.horasEstimadas,
            custoAquisicaoUnitario: resultado.custoAquisicaoUnitario,
            custoFaca: resultado.custoFaca,
            materialFornecidoPeloCliente: resultado.materialFornecidoPeloCliente,
            breakdown: resultado.breakdown ?? undefined,
            etiqueta:
              resultado.modeloCalculo === "M2"
                ? {
                    create: {
                      materialSubstrato: etiqueta?.materialSubstrato ?? null,
                      materialSubstratoOutro: etiqueta?.materialSubstratoOutro ?? null,
                      tipoAdesivo: etiqueta?.tipoAdesivo ?? null,
                      tipoAdesivoOutro: etiqueta?.tipoAdesivoOutro ?? null,
                      durabilidadeAdesivo: etiqueta?.durabilidadeAdesivo ?? null,
                      superficieAplicacao: etiqueta?.superficieAplicacao ?? null,
                      superficieAplicacaoOutro: etiqueta?.superficieAplicacaoOutro ?? null,
                      formatoEtiqueta: etiqueta?.formatoEtiqueta ?? null,
                      coresRotulo: etiqueta?.coresRotulo ?? null,
                      coresContraRotulo: etiqueta?.coresContraRotulo ?? null,
                      embalagemQtdPorRolo: etiqueta?.embalagemQtdPorRolo ?? null,
                      tubeteMedida: etiqueta?.tubeteMedida ?? null,
                      rotulagem: etiqueta?.rotulagem ?? null,
                      serrilha: etiqueta?.serrilha ?? null,
                      serrilhaOutro: etiqueta?.serrilhaOutro ?? null,
                      vernizRotuloTotal: etiqueta?.vernizRotuloTotal ?? false,
                      vernizRotuloReserva: etiqueta?.vernizRotuloReserva ?? false,
                      vernizRotuloTipo: etiqueta?.vernizRotuloTipo ?? null,
                      vernizRotuloTipoOutro: etiqueta?.vernizRotuloTipoOutro ?? null,
                      vernizContraRotuloTotal: etiqueta?.vernizContraRotuloTotal ?? false,
                      vernizContraRotuloReserva: etiqueta?.vernizContraRotuloReserva ?? false,
                      vernizContraRotuloTipo: etiqueta?.vernizContraRotuloTipo ?? null,
                      vernizContraRotuloTipoOutro: etiqueta?.vernizContraRotuloTipoOutro ?? null,
                      laminacaoRotulo: etiqueta?.laminacaoRotulo ?? null,
                      laminacaoRotuloOutro: etiqueta?.laminacaoRotuloOutro ?? null,
                      laminacaoContraRotulo: etiqueta?.laminacaoContraRotulo ?? null,
                      laminacaoContraRotuloOutro: etiqueta?.laminacaoContraRotuloOutro ?? null,
                      rebobinamento: etiqueta?.rebobinamento ?? null,
                      hotStampings: {
                        create: (etiqueta?.hotStampings ?? []).map((h) => ({
                          lado: h.lado,
                          tipo: h.tipo,
                          tipoOutro: h.tipoOutro || null,
                          tipoEfeitoHotStamping: h.tipoEfeitoHotStamping || null,
                          medida: h.medida || null,
                          cor: h.cor || null,
                        })),
                      },
                    },
                  }
                : undefined,
            acabamentos:
              resultado.acabamentos.length > 0
                ? {
                    create: resultado.acabamentos.map((a) => ({
                      itemGraficaId: a.itemGraficaId,
                      qtdBase: a.qtdBase,
                      custoCalculado: a.custoCalculado,
                    })),
                  }
                : undefined,
            precificacaoEtiqueta: resultado.precificacaoEtiqueta
              ? {
                  create: {
                    papelId: resultado.precificacaoEtiqueta.papelId,
                    quantidadeCores: resultado.precificacaoEtiqueta.quantidadeCores,
                    custoClicheCalculado: resultado.precificacaoEtiqueta.custoClicheCalculado,
                    custoFaca: resultado.precificacaoEtiqueta.custoFaca,
                    custoFrete: resultado.precificacaoEtiqueta.custoFrete,
                  },
                }
              : undefined,
            // Achado N4 (correção de gap encontrado durante a revisão do
            // N8) — mesmo padrão de precificacaoEtiqueta acima, nunca
            // existia aqui antes.
            precificacaoDigital: resultado.precificacaoDigital
              ? {
                  create: {
                    papelId: resultado.precificacaoDigital.papelId,
                  },
                }
              : undefined,
            // Achado N8 — snapshot do papel/gramatura Offset OVERRIDDEN
            // neste orçamento, mesmo padrão de precificacaoEtiqueta acima.
            precificacaoOffset: resultado.precificacaoOffset
              ? {
                  create: {
                    papelId: resultado.precificacaoOffset.papelId,
                    gramaturaGm2: resultado.precificacaoOffset.gramaturaGm2,
                  },
                }
              : undefined,
          },
        });
        // opcaoId: null — mesmo cuidado de editarOrcamento acima. Item novo
        // criado por esta action nunca leva opcaoId (nasce sempre na
        // opção-base, ver create acima). Achado N3 — piso de pedido aplicado
        // uma vez sobre a soma, ver recalcularTotalOrcamento.
        await recalcularTotalOrcamento(tx, orcamentoId, usuario.graficaId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (erro) {
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO_CONCORRENTE };
    }
    throw erro;
  }

  revalidatePath(`/orcamento/${orcamentoId}`);
  revalidatePath("/orcamento");

  return { ok: true, mensagem: "Item adicionado com sucesso!" };
}

export type RemoverItemResult = { ok: boolean; mensagem: string };

export async function removerItemOrcamento(
  _estadoAnterior: RemoverItemResult | null,
  formData: FormData
): Promise<RemoverItemResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoItemId = String(formData.get("orcamentoItemId"));

  const item = await prisma.orcamentoItem.findFirst({
    // opcaoId: null — esta action só remove item da opção-base; um item de
    // opção alternativa só sai junto da opção inteira (removerOpcaoOrcamento
    // em opcoes.actions.ts).
    where: { id: orcamentoItemId, opcaoId: null, orcamento: { graficaId: usuario.graficaId } },
    include: { orcamento: true },
  });
  if (!item) {
    return { ok: false, mensagem: "Item não encontrado." };
  }
  if (item.orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível remover itens de um orçamento em rascunho." };
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        // Contagem refeita AQUI DENTRO (não a partir de uma leitura solta) —
        // sob Serializable, duas remoções concorrentes no mesmo orçamento não
        // conseguem as duas passar por essa checagem: uma é abortada com
        // conflito de serialização (ver catch abaixo). opcaoId: null — só
        // conta itens da opção-base; ela precisa ter pelo menos 1 item
        // independente de quantas opções alternativas existirem.
        const quantidadeItens = await tx.orcamentoItem.count({
          where: { orcamentoId: item.orcamentoId, opcaoId: null },
        });
        if (quantidadeItens <= 1) {
          throw new ErroUltimoItemOrcamento();
        }

        await tx.orcamentoItem.delete({ where: { id: orcamentoItemId } });

        // Achado N3 — piso de pedido aplicado uma vez sobre a soma dos itens
        // que sobraram, ver recalcularTotalOrcamento.
        await recalcularTotalOrcamento(tx, item.orcamentoId, usuario.graficaId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (erro) {
    if (erro instanceof ErroUltimoItemOrcamento) {
      return {
        ok: false,
        mensagem:
          "O orçamento precisa ter pelo menos um item — cancele o orçamento se quiser removê-lo por completo.",
      };
    }
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO_CONCORRENTE };
    }
    throw erro;
  }

  // A linha de OrcamentoItemTinta já foi cascade-apagada junto do item, mas
  // o razão de armazenamento (ArquivoArmazenado) e o arquivo de verdade no
  // Blob NÃO — só têm relação com Grafica, não com OrcamentoItem. Melhor
  // esforço, depois que a remoção do item já foi confirmada.
  const arquivoTintaRemovido = await removerArquivo({
    graficaId: usuario.graficaId,
    tipo: "ANALISE_TINTA",
    referenciaId: orcamentoItemId,
  });
  if (arquivoTintaRemovido) {
    await del(arquivoTintaRemovido.url, { token: exigirTokenBlobPrivado() }).catch(() => {});
  }

  revalidatePath(`/orcamento/${item.orcamentoId}`);
  revalidatePath("/orcamento");

  return { ok: true, mensagem: "Item removido." };
}

const tipoDescontoFormSchema = z.enum(["PERCENTUAL", "VALOR_ABSOLUTO", "PRECO_FINAL"]);

export type AplicarDescontoResult = { ok: boolean; mensagem: string };

// Aplica (tipo+valor+motivo) ou remove (remover=true) um desconto negociado
// sobre o preço sugerido pelo motor num item já adicionado ao orçamento (ver
// fase-custo-real.md §2.4, §4.2). precoUnitario/precoTotal continuam sendo
// o VALOR VENDIDO de sempre — esta action só os recalcula a partir de
// precoSugeridoUnitario (gravado uma única vez em adicionarItemOrcamento,
// nunca mexido depois) + o desconto pedido aqui. Duas travas inegociáveis:
// preço negociado nunca fica abaixo do custo direto do item (mesma
// checagem/mensagem da trava que o motor já usa pro preço SUGERIDO, ver
// ErroPrecificacao "PRECO_ABAIXO_DO_CUSTO" em src/lib/pricing/compor.ts), e
// desconto acima do limite RESOLVIDO pro usuário (achado A4 da auditoria de
// abrangência — alçada do usuário > alçada do papel > DONO/ADMIN sem teto/
// OPERADOR travado no limite global da gráfica, ver resolverLimiteDesconto
// em src/lib/alcada-aprovacao.ts) é bloqueado (grava aprovadoPorId quando
// aplicado por alguém acima do limite GLOBAL da gráfica).
export async function aplicarDescontoItemOrcamento(
  _estadoAnterior: AplicarDescontoResult | null,
  formData: FormData
): Promise<AplicarDescontoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }

  const orcamentoItemId = String(formData.get("orcamentoItemId"));
  const remover = formData.get("remover") === "true";
  const motivo = String(formData.get("motivo") || "").trim().slice(0, 300);

  const item = await prisma.orcamentoItem.findFirst({
    // opcaoId: null — desconto negociado só se aplica na opção-base; uma
    // opção alternativa não tem edição incremental de item (ver comentário
    // em removerItemOrcamento acima).
    where: { id: orcamentoItemId, opcaoId: null, orcamento: { graficaId: usuario.graficaId } },
    include: {
      orcamento: { select: { status: true } },
      itemGrafica: { select: { precoCompra: true, simplesCobraPorArea: true } },
    },
  });
  if (!item) {
    return { ok: false, mensagem: "Item não encontrado." };
  }
  if (item.orcamento.status !== "RASCUNHO") {
    return {
      ok: false,
      mensagem: "Só é possível alterar o preço negociado de um item em um orçamento em rascunho.",
    };
  }
  // Item criado antes desta funcionalidade (precoSugeridoUnitario nasceu
  // nulo pra tudo que já existia) — sem uma baseline sugerida não dá pra
  // calcular desconto algum. Renderiza normalmente (ver EditarOrcamentoForm),
  // só não deixa aplicar aqui.
  if (item.precoSugeridoUnitario === null) {
    return {
      ok: false,
      mensagem:
        "Este item não tem preço sugerido registrado (foi criado antes desta funcionalidade) — remova e adicione o item novamente para negociar o preço.",
    };
  }

  const precoSugerido = paraDecimal(item.precoSugeridoUnitario.toString());
  const quantidade = item.quantidade;
  const precoUnitarioAnterior = item.precoUnitario.toString();

  let novoPrecoUnitario: Dec;
  let descontoTipoGravar: z.infer<typeof tipoDescontoFormSchema> | null = null;
  let descontoValorGravar: Dec | null = null;

  if (remover) {
    novoPrecoUnitario = precoSugerido.toDecimalPlaces(2);
  } else {
    const tipoParsed = tipoDescontoFormSchema.safeParse(formData.get("tipo"));
    if (!tipoParsed.success) {
      return { ok: false, mensagem: "Tipo de desconto inválido." };
    }
    if (!motivo) {
      return { ok: false, mensagem: "Informe o motivo do desconto." };
    }
    const valorNumero = Number(formData.get("valor"));
    if (!Number.isFinite(valorNumero)) {
      return { ok: false, mensagem: "Informe um valor de desconto válido." };
    }

    if (tipoParsed.data === "PERCENTUAL") {
      if (valorNumero < 0 || valorNumero >= 100) {
        return { ok: false, mensagem: "Informe um percentual de desconto entre 0 e 100." };
      }
      novoPrecoUnitario = precoSugerido
        .times(paraDecimal(1).minus(paraDecimal(valorNumero).div(100)))
        .toDecimalPlaces(2);
      descontoValorGravar = paraDecimal(valorNumero);
    } else if (tipoParsed.data === "VALOR_ABSOLUTO") {
      if (valorNumero < 0) {
        return { ok: false, mensagem: "Informe um valor de desconto maior ou igual a zero." };
      }
      novoPrecoUnitario = precoSugerido.minus(paraDecimal(valorNumero)).toDecimalPlaces(2);
      descontoValorGravar = paraDecimal(valorNumero);
    } else {
      if (valorNumero < 0) {
        return { ok: false, mensagem: "Informe um preço final válido." };
      }
      novoPrecoUnitario = paraDecimal(valorNumero).toDecimalPlaces(2);
      descontoValorGravar = precoSugerido.minus(novoPrecoUnitario);
    }
    descontoTipoGravar = tipoParsed.data;

    if (novoPrecoUnitario.lte(0)) {
      return { ok: false, mensagem: "O preço negociado precisa ser maior que zero." };
    }
  }

  const novoPrecoTotal = novoPrecoUnitario.times(quantidade);

  // Trava de preço mínimo — mesma checagem/mensagem que o motor já usa pra
  // travar o preço SUGERIDO, aplicada agora ao preço NEGOCIADO. Custo direto
  // calculado do mesmo jeito que o bloco de comissão logo acima neste mesmo
  // arquivo (breakdown.custoTotal pra M2/OFFSET, precoCompra × quantidade —
  // × área quando o produto SIMPLES cobra por m², achado N11(b) — pra
  // SIMPLES) — nunca inventa um número novo pra "custo". Remover desconto
  // sempre volta pro preço que o motor já validou na criação, então não
  // precisa passar por esta checagem de novo.
  if (!remover) {
    const breakdown = item.breakdown as { custoTotal?: string } | null;
    // Achado N11(b) — mesma área usada pra calcular o PREÇO deste item
    // (calcularPreco em src/lib/orcamento.ts), só que aplicada ao CUSTO: sem
    // isso, um item SIMPLES cobrado por m² (banner/lona) tinha o custo
    // calculado só por peça, e a trava abaixo liberava um desconto que na
    // prática vendia abaixo do custo real.
    const areaM2 =
      item.itemGrafica.simplesCobraPorArea && item.larguraCm && item.alturaCm
        ? (Number(item.larguraCm) / 100) * (Number(item.alturaCm) / 100)
        : 1;
    // Achado N11(a) — precoCompra ausente é custo DESCONHECIDO, não zero:
    // tratar como 0 liberava desconto irrestrito (inclusive pra DONO/ADMIN,
    // que nem passam pela trava de alçada abaixo). Sem dado de custo, usa o
    // próprio preço SUGERIDO (sem desconto) como piso — bloqueia qualquer
    // desconto neste item até que o custo de compra seja cadastrado no
    // catálogo, sem travar a venda no preço cheio.
    const custoConhecido = Boolean(breakdown?.custoTotal) || item.itemGrafica.precoCompra !== null;
    const custoDiretoNumero = breakdown?.custoTotal
      ? Number(breakdown.custoTotal)
      : item.itemGrafica.precoCompra
        ? Number(item.itemGrafica.precoCompra) * quantidade * areaM2
        : precoSugerido.times(quantidade).toNumber();
    const custoDireto = paraDecimal(custoDiretoNumero);

    if (novoPrecoTotal.lt(custoDireto)) {
      return {
        ok: false,
        mensagem: custoConhecido
          ? "O preço final calculado ficou abaixo do custo direto — configuração de margem/encargos provavelmente incorreta. Orçamento abortado por segurança."
          : "Este produto não tem custo de compra cadastrado no catálogo — não é possível confirmar que o desconto fica acima do custo. Cadastre o preço de compra em Catálogo antes de negociar este item.",
      };
    }
  }

  // Trava de aprovação — desconto efetivo sobre o preço SUGERIDO (baseline
  // fixa, não sobre o preço vendido anterior, que já poderia ter outro
  // desconto embutido). Só entra em jogo aplicando desconto: remover volta
  // ao sugerido = 0% de desconto, sem checagem.
  let aprovadoPorId: string | null = null;
  let descontoPercentualEfetivo: Dec | null = null;
  if (!remover) {
    descontoPercentualEfetivo = precoSugerido.gt(0)
      ? paraDecimal(1).minus(novoPrecoUnitario.div(precoSugerido)).times(100)
      : paraDecimal(0);

    const parametros = await prisma.parametrosGrafica.findUnique({
      where: { graficaId: usuario.graficaId },
      select: { descontoMaxSemAprovacao: true },
    });
    const limite = parametros
      ? paraDecimal(parametros.descontoMaxSemAprovacao.toString())
      : paraDecimal(100);

    // Achado A4 da auditoria de abrangência — limite RESOLVIDO pra este
    // usuário específico (alçada dele > alçada do papel dele > fallback
    // idêntico ao comportamento de sempre). Sem nenhuma AlcadaAprovacao
    // cadastrada, limiteResolvido === o mesmo cálculo hardcoded de antes
    // (DONO/ADMIN sem teto, OPERADOR travado no `limite` global acima) —
    // regressão zero pra quem nunca configurar nada.
    const alcadasDesconto = await buscarAlcadasDesconto(usuario.graficaId);
    const limiteResolvido = paraDecimal(
      resolverLimiteDesconto(usuario, alcadasDesconto, Number(limite))
    );

    if (descontoPercentualEfetivo.gt(limiteResolvido)) {
      const temAlcadaConfigurada = alcadasDesconto.some(
        (a) => a.usuarioId === usuario.id || a.papel === usuario.papel
      );
      return {
        ok: false,
        mensagem: temAlcadaConfigurada
          ? `Desconto acima de ${limiteResolvido.toFixed(1)}% (sua alçada) precisa ser aplicado por alguém com alçada maior.`
          : `Desconto acima de ${limiteResolvido.toFixed(1)}% precisa ser aplicado por um dono ou administrador.`,
      };
    }
    if (descontoPercentualEfetivo.gt(limite)) {
      aprovadoPorId = usuario.id;
    }
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.orcamentoItem.update({
          where: { id: orcamentoItemId },
          data: {
            precoUnitario: novoPrecoUnitario.toFixed(2),
            precoTotal: novoPrecoTotal.toFixed(2),
            descontoTipo: descontoTipoGravar,
            descontoValor: descontoValorGravar ? descontoValorGravar.toFixed(4) : null,
            motivoDesconto: remover ? null : motivo,
            aprovadoPorId,
          },
        });
        // opcaoId: null — mesmo cuidado dos outros três pontos de agregação
        // deste arquivo (ver editarOrcamento/adicionarItemOrcamento/
        // removerItemOrcamento acima). Achado N3 — piso de pedido aplicado
        // uma vez sobre a soma, ver recalcularTotalOrcamento.
        await recalcularTotalOrcamento(tx, item.orcamentoId, usuario.graficaId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (erro) {
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO_CONCORRENTE };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: remover ? "orcamento_item.remover_desconto" : "orcamento_item.aplicar_desconto",
    entidade: "OrcamentoItem",
    entidadeId: orcamentoItemId,
    descricao: remover
      ? `Removeu o desconto do item #${orcamentoItemId.slice(-6)} — preço restaurado para ${formatoMoeda.format(novoPrecoUnitario.toNumber())}/un.`
      : `Aplicou desconto de ${descontoPercentualEfetivo!.toFixed(1)}% no item #${orcamentoItemId.slice(-6)}, de ${formatoMoeda.format(Number(precoUnitarioAnterior))} para ${formatoMoeda.format(novoPrecoUnitario.toNumber())}/un — motivo: ${motivo}`,
  });

  revalidatePath(`/orcamento/${item.orcamentoId}`);
  revalidatePath("/orcamento");

  return { ok: true, mensagem: remover ? "Desconto removido." : "Desconto aplicado." };
}
