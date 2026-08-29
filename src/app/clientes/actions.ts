"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { clienteSchema } from "@/lib/clientes";
import { contatoClienteSchema, ORDEM_FUNCAO_CONTATO_CLIENTE } from "@/lib/contatos-cliente";
import { ehViolacaoDeChaveEstrangeira } from "@/lib/prisma-conflito";
import { registrarAuditoria } from "@/lib/auditoria";
import {
  ORDEM_ORIGEM_CLIENTE,
  ORDEM_SEGMENTO_CLIENTE,
  ORDEM_TIPO_PESSOA,
  ORDEM_INDICADOR_INSCRICAO_ESTADUAL,
  ORDEM_FORMA_PAGAMENTO_CLIENTE,
} from "@/lib/tipos-cliente";
import type {
  OrigemCliente,
  SegmentoCliente,
  TipoPessoa,
  IndicadorInscricaoEstadual,
  FuncaoContatoCliente,
  FormaPagamento,
} from "@/generated/prisma/enums";

// Mesmo padrão do resto do schema (UnidadeMedida, CategoriaEquipamento etc.):
// origem vem de uma lista fechada com OUTRO de escape — origemOutro só é
// obrigatório nesse caso, nunca trava um cliente real fora da lista. Campo
// em si é opcional (formulário sem seleção -> undefined -> null no banco),
// mesmo padrão de validarCategoria em
// configuracoes/maquinas/equipamentos/actions.ts.
function validarOrigem(
  formData: FormData
): { ok: true; origem: OrigemCliente | null; origemOutro: string | null } | { ok: false; mensagem: string } {
  const origem = String(formData.get("origem") ?? "").trim();
  if (!origem) {
    return { ok: true, origem: null, origemOutro: null };
  }
  if (!ORDEM_ORIGEM_CLIENTE.includes(origem as OrigemCliente)) {
    return { ok: false, mensagem: "Origem do cliente inválida." };
  }
  if (origem === "OUTRO") {
    const origemOutro = String(formData.get("origemOutro") ?? "").trim();
    if (!origemOutro) {
      return { ok: false, mensagem: 'Descreva a origem quando escolher "Outro".' };
    }
    return { ok: true, origem: "OUTRO", origemOutro };
  }
  return { ok: true, origem: origem as OrigemCliente, origemOutro: null };
}

// Achado A7 da auditoria de abrangência — mesmo padrão de validarOrigem
// acima, lista fechada com OUTRO de escape, segmentoOutro só obrigatório
// nesse caso, campo em si opcional.
function validarSegmento(
  formData: FormData
): { ok: true; segmento: SegmentoCliente | null; segmentoOutro: string | null } | { ok: false; mensagem: string } {
  const segmento = String(formData.get("segmento") ?? "").trim();
  if (!segmento) {
    return { ok: true, segmento: null, segmentoOutro: null };
  }
  if (!ORDEM_SEGMENTO_CLIENTE.includes(segmento as SegmentoCliente)) {
    return { ok: false, mensagem: "Segmento de cliente inválido." };
  }
  if (segmento === "OUTRO") {
    const segmentoOutro = String(formData.get("segmentoOutro") ?? "").trim();
    if (!segmentoOutro) {
      return { ok: false, mensagem: 'Descreva o segmento quando escolher "Outro".' };
    }
    return { ok: true, segmento: "OUTRO", segmentoOutro };
  }
  return { ok: true, segmento: segmento as SegmentoCliente, segmentoOutro: null };
}

// Achado A1 da auditoria de abrangência — distinção Pessoa Física × Pessoa
// Jurídica, mesmo padrão de validarOrigem/validarSegmento acima (lista
// fechada, campo em si opcional). Diferente dos outros dois: não tem
// "*Outro" de escape, porque o enum não tem OUTRO (ver comentário no schema).
function validarTipoPessoa(
  formData: FormData
): { ok: true; tipoPessoa: TipoPessoa | null } | { ok: false; mensagem: string } {
  const tipoPessoa = String(formData.get("tipoPessoa") ?? "").trim();
  if (!tipoPessoa) {
    return { ok: true, tipoPessoa: null };
  }
  if (!ORDEM_TIPO_PESSOA.includes(tipoPessoa as TipoPessoa)) {
    return { ok: false, mensagem: "Tipo de pessoa inválido." };
  }
  return { ok: true, tipoPessoa: tipoPessoa as TipoPessoa };
}

// Achado A1 — indicador de contribuinte de ICMS do destinatário (tag
// indIEDest da NF-e 4.0). Mesmo padrão de validarTipoPessoa acima. A regra
// "IE só quando CONTRIBUINTE" é aplicada na emissão (src/lib/focus-nfe.ts) e
// verificada em verificarProntidaoFiscal (src/lib/nota-fiscal.ts) — aqui só
// valida que o valor é um dos 3 conhecidos.
function validarIndicadorInscricaoEstadual(
  formData: FormData
): { ok: true; indicador: IndicadorInscricaoEstadual | null } | { ok: false; mensagem: string } {
  const indicador = String(formData.get("indicadorInscricaoEstadual") ?? "").trim();
  if (!indicador) {
    return { ok: true, indicador: null };
  }
  if (!ORDEM_INDICADOR_INSCRICAO_ESTADUAL.includes(indicador as IndicadorInscricaoEstadual)) {
    return { ok: false, mensagem: "Indicador de Inscrição Estadual inválido." };
  }
  return { ok: true, indicador: indicador as IndicadorInscricaoEstadual };
}

// Achado A8 da auditoria de abrangência — vendedor/responsável comercial do
// cliente, opcional. Precisa pertencer à MESMA gráfica (nunca confia no id
// cru do formulário) e estar ativo — a lista que alimenta o <select> já só
// mostra usuários com desativadoEm: null, então um id de usuário desativado
// aqui só pode vir de um POST forjado.
async function validarVendedorId(
  formData: FormData,
  graficaId: string
): Promise<{ ok: true; vendedorId: string | null } | { ok: false; mensagem: string }> {
  const vendedorId = String(formData.get("vendedorId") ?? "").trim();
  if (!vendedorId) {
    return { ok: true, vendedorId: null };
  }
  const vendedor = await prisma.usuario.findFirst({
    where: { id: vendedorId, graficaId, desativadoEm: null },
    select: { id: true },
  });
  if (!vendedor) {
    return { ok: false, mensagem: "Vendedor inválido." };
  }
  return { ok: true, vendedorId: vendedor.id };
}

// Achado A7 — sobrescreve ParametrosGrafica.margemPadrao só pra este
// cliente. Mesmo formato de ParametrosGrafica.margemPadrao (fração 0-1,
// nunca 0-100) e mesma guarda de presença-antes-de-Number() de
// salvarParametros (src/app/configuracoes/actions.ts): campo em branco vira
// null (sem override, comportamento de hoje), mas um valor presente e
// inválido (negativo, não numérico) é rejeitado em vez de gravado como 0
// silenciosamente.
function validarMargemPadraoOverride(
  formData: FormData
): { ok: true; valor: number | null } | { ok: false; mensagem: string } {
  const bruto = formData.get("margemPadraoOverride");
  if (typeof bruto !== "string" || bruto.trim() === "") {
    return { ok: true, valor: null };
  }
  const valor = Number(bruto);
  if (!Number.isFinite(valor) || valor < 0) {
    return { ok: false, mensagem: "Margem diferenciada inválida." };
  }
  return { ok: true, valor };
}

// Achado A6 da Parte 4 da auditoria de abrangência — teto de exposição de
// crédito do cliente (ver Cliente.limiteCredito no schema pra distinção com
// bloqueadoParaVenda). Mesma guarda de presença-antes-de-Number() de
// validarMargemPadraoOverride acima: em branco = sem limite (comportamento
// de hoje), presente e inválido é rejeitado, nunca vira 0 silenciosamente
// (0 seria um limite de crédito real e válido, diferente de "sem limite").
function validarLimiteCredito(
  formData: FormData
): { ok: true; valor: number | null } | { ok: false; mensagem: string } {
  const bruto = formData.get("limiteCredito");
  if (typeof bruto !== "string" || bruto.trim() === "") {
    return { ok: true, valor: null };
  }
  const valor = Number(bruto);
  if (!Number.isFinite(valor) || valor < 0) {
    return { ok: false, mensagem: "Limite de crédito inválido." };
  }
  return { ok: true, valor };
}

// Mesmo padrão de validarLimiteCredito acima — puramente informativo hoje
// (ver comentário do campo no schema), mas validado do mesmo jeito rigoroso
// pra não gravar lixo no cadastro.
function validarPrazoPagamentoPadraoDias(
  formData: FormData
): { ok: true; valor: number | null } | { ok: false; mensagem: string } {
  const bruto = formData.get("prazoPagamentoPadraoDias");
  if (typeof bruto !== "string" || bruto.trim() === "") {
    return { ok: true, valor: null };
  }
  const valor = Number(bruto);
  if (!Number.isInteger(valor) || valor < 0) {
    return { ok: false, mensagem: "Prazo de pagamento padrão inválido — use um número inteiro de dias." };
  }
  return { ok: true, valor };
}

// Achado A6 da Parte 5 da auditoria de abrangência — mesmo padrão de
// validarTipoPessoa acima (enum-fechado, campo em si opcional). Sem *Outro
// de escape (ver comentário em ORDEM_FORMA_PAGAMENTO_CLIENTE no
// tipos-cliente.ts pra por quê).
function validarFormaPagamentoPreferida(
  formData: FormData
): { ok: true; forma: FormaPagamento | null } | { ok: false; mensagem: string } {
  const forma = String(formData.get("formaPagamentoPreferida") ?? "").trim();
  if (!forma) {
    return { ok: true, forma: null };
  }
  if (!ORDEM_FORMA_PAGAMENTO_CLIENTE.includes(forma as FormaPagamento)) {
    return { ok: false, mensagem: "Forma de pagamento preferida inválida." };
  }
  return { ok: true, forma: forma as FormaPagamento };
}

// Achado A6 da Parte 5 — mesmo padrão de validarMargemPadraoOverride acima
// (fração 0-1, guarda de presença-antes-de-Number()), mas com teto de 1
// (100%): diferente de margem, desconto acima de 100% não faz sentido em
// nenhum cenário. Só uma SUGESTÃO de preenchimento (ver comentário no
// schema) — quem aplica ainda passa pela trava de descontoMaxSemAprovacao no
// momento de aplicar, então isto aqui não precisa (nem deveria) repetir
// aquela regra.
function validarDescontoPadraoPercent(
  formData: FormData
): { ok: true; valor: number | null } | { ok: false; mensagem: string } {
  const bruto = formData.get("descontoPadraoPercent");
  if (typeof bruto !== "string" || bruto.trim() === "") {
    return { ok: true, valor: null };
  }
  const valor = Number(bruto);
  if (!Number.isFinite(valor) || valor < 0 || valor > 1) {
    return { ok: false, mensagem: "Desconto padrão inválido — use uma fração entre 0 e 1 (ex: 0.1 para 10%)." };
  }
  return { ok: true, valor };
}

export type CriarClienteResult = { ok: boolean; mensagem: string };

export async function criarCliente(
  _estadoAnterior: CriarClienteResult | null,
  formData: FormData
): Promise<CriarClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CLIENTES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar clientes." };
  }

  const parsed = clienteSchema.safeParse({
    nome: formData.get("nome"),
    email: formData.get("email"),
    telefone: formData.get("telefone"),
    documento: formData.get("documento"),
    enderecoCep: formData.get("enderecoCep"),
    enderecoLogradouro: formData.get("enderecoLogradouro"),
    enderecoNumero: formData.get("enderecoNumero"),
    enderecoComplemento: formData.get("enderecoComplemento"),
    enderecoBairro: formData.get("enderecoBairro"),
    enderecoMunicipio: formData.get("enderecoMunicipio"),
    enderecoCodigoIbge: formData.get("enderecoCodigoIbge"),
    enderecoUf: formData.get("enderecoUf"),
    observacoes: formData.get("observacoes"),
    preferenciasProducao: formData.get("preferenciasProducao"),
    razaoSocial: formData.get("razaoSocial"),
    nomeFantasia: formData.get("nomeFantasia"),
    inscricaoEstadual: formData.get("inscricaoEstadual"),
    inscricaoMunicipal: formData.get("inscricaoMunicipal"),
  });

  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const validacaoOrigem = validarOrigem(formData);
  if (!validacaoOrigem.ok) {
    return validacaoOrigem;
  }
  const validacaoSegmento = validarSegmento(formData);
  if (!validacaoSegmento.ok) {
    return validacaoSegmento;
  }
  const validacaoTipoPessoa = validarTipoPessoa(formData);
  if (!validacaoTipoPessoa.ok) {
    return validacaoTipoPessoa;
  }
  const validacaoIndicadorIe = validarIndicadorInscricaoEstadual(formData);
  if (!validacaoIndicadorIe.ok) {
    return validacaoIndicadorIe;
  }
  const validacaoMargem = validarMargemPadraoOverride(formData);
  if (!validacaoMargem.ok) {
    return validacaoMargem;
  }
  const validacaoVendedor = await validarVendedorId(formData, usuario.graficaId);
  if (!validacaoVendedor.ok) {
    return validacaoVendedor;
  }

  const {
    nome,
    email,
    telefone,
    documento,
    enderecoCep,
    enderecoLogradouro,
    enderecoNumero,
    enderecoComplemento,
    enderecoBairro,
    enderecoMunicipio,
    enderecoCodigoIbge,
    enderecoUf,
    observacoes,
    preferenciasProducao,
    razaoSocial,
    nomeFantasia,
    inscricaoEstadual,
    inscricaoMunicipal,
  } = parsed.data;

  try {
    await prisma.cliente.create({
      data: {
        graficaId: usuario.graficaId,
        nome,
        email: email || null,
        telefone: telefone || null,
        documento: documento || null,
        enderecoCep: enderecoCep || null,
        enderecoLogradouro: enderecoLogradouro || null,
        enderecoNumero: enderecoNumero || null,
        enderecoComplemento: enderecoComplemento || null,
        enderecoBairro: enderecoBairro || null,
        enderecoMunicipio: enderecoMunicipio || null,
        enderecoCodigoIbge: enderecoCodigoIbge || null,
        enderecoUf: enderecoUf || null,
        observacoes: observacoes || null,
        tipoPessoa: validacaoTipoPessoa.tipoPessoa,
        razaoSocial: razaoSocial || null,
        nomeFantasia: nomeFantasia || null,
        inscricaoEstadual: inscricaoEstadual || null,
        indicadorInscricaoEstadual: validacaoIndicadorIe.indicador,
        inscricaoMunicipal: inscricaoMunicipal || null,
        preferenciasProducao: preferenciasProducao || null,
        origem: validacaoOrigem.origem,
        origemOutro: validacaoOrigem.origemOutro,
        segmento: validacaoSegmento.segmento,
        segmentoOutro: validacaoSegmento.segmentoOutro,
        margemPadraoOverride: validacaoMargem.valor,
        vendedorId: validacaoVendedor.vendedorId,
      },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe um cliente cadastrado com esse CPF/CNPJ." };
    }
    throw erro;
  }

  revalidatePath("/clientes");
  revalidatePath("/orcamento");
  revalidatePath("/comecar");

  return { ok: true, mensagem: `Cliente "${nome}" cadastrado com sucesso!` };
}

export type AtualizarClienteResult = { ok: boolean; mensagem: string };

export async function atualizarCliente(
  _estadoAnterior: AtualizarClienteResult | null,
  formData: FormData
): Promise<AtualizarClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CLIENTES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar clientes." };
  }
  const clienteId = String(formData.get("clienteId"));

  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId: usuario.graficaId },
  });
  if (!cliente) {
    return { ok: false, mensagem: "Cliente não encontrado." };
  }

  const parsed = clienteSchema.safeParse({
    nome: formData.get("nome"),
    email: formData.get("email"),
    telefone: formData.get("telefone"),
    documento: formData.get("documento"),
    enderecoCep: formData.get("enderecoCep"),
    enderecoLogradouro: formData.get("enderecoLogradouro"),
    enderecoNumero: formData.get("enderecoNumero"),
    enderecoComplemento: formData.get("enderecoComplemento"),
    enderecoBairro: formData.get("enderecoBairro"),
    enderecoMunicipio: formData.get("enderecoMunicipio"),
    enderecoCodigoIbge: formData.get("enderecoCodigoIbge"),
    enderecoUf: formData.get("enderecoUf"),
    observacoes: formData.get("observacoes"),
    preferenciasProducao: formData.get("preferenciasProducao"),
    razaoSocial: formData.get("razaoSocial"),
    nomeFantasia: formData.get("nomeFantasia"),
    inscricaoEstadual: formData.get("inscricaoEstadual"),
    inscricaoMunicipal: formData.get("inscricaoMunicipal"),
    observacaoFinanceira: formData.get("observacaoFinanceira"),
  });

  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const validacaoOrigem = validarOrigem(formData);
  if (!validacaoOrigem.ok) {
    return validacaoOrigem;
  }
  const validacaoSegmento = validarSegmento(formData);
  if (!validacaoSegmento.ok) {
    return validacaoSegmento;
  }
  const validacaoTipoPessoa = validarTipoPessoa(formData);
  if (!validacaoTipoPessoa.ok) {
    return validacaoTipoPessoa;
  }
  const validacaoIndicadorIe = validarIndicadorInscricaoEstadual(formData);
  if (!validacaoIndicadorIe.ok) {
    return validacaoIndicadorIe;
  }
  const validacaoMargem = validarMargemPadraoOverride(formData);
  if (!validacaoMargem.ok) {
    return validacaoMargem;
  }
  const validacaoVendedor = await validarVendedorId(formData, usuario.graficaId);
  if (!validacaoVendedor.ok) {
    return validacaoVendedor;
  }
  const validacaoLimiteCredito = validarLimiteCredito(formData);
  if (!validacaoLimiteCredito.ok) {
    return validacaoLimiteCredito;
  }
  const validacaoPrazoPagamento = validarPrazoPagamentoPadraoDias(formData);
  if (!validacaoPrazoPagamento.ok) {
    return validacaoPrazoPagamento;
  }
  const validacaoFormaPagamento = validarFormaPagamentoPreferida(formData);
  if (!validacaoFormaPagamento.ok) {
    return validacaoFormaPagamento;
  }
  const validacaoDescontoPadrao = validarDescontoPadraoPercent(formData);
  if (!validacaoDescontoPadrao.ok) {
    return validacaoDescontoPadrao;
  }

  const {
    nome,
    email,
    telefone,
    documento,
    enderecoCep,
    enderecoLogradouro,
    enderecoNumero,
    enderecoComplemento,
    enderecoBairro,
    enderecoMunicipio,
    enderecoCodigoIbge,
    enderecoUf,
    observacoes,
    preferenciasProducao,
    razaoSocial,
    nomeFantasia,
    inscricaoEstadual,
    inscricaoMunicipal,
    observacaoFinanceira,
  } = parsed.data;

  // bloqueadoParaVenda/motivoBloqueio e bloqueadoParaFaturamento/
  // motivoBloqueioFaturamento ficam fora do clienteSchema (zod) de
  // propósito: esse schema é reusado byte-a-byte pela importação de
  // planilha (src/lib/importacao/campos.ts), e esses campos são conceito de
  // bloqueio comercial, não dado de cadastro — não faz sentido nem é seguro
  // estender o schema compartilhado aqui.
  const bloqueadoParaVenda = formData.get("bloqueadoParaVenda") === "on";
  const motivoBloqueioRaw = String(formData.get("motivoBloqueio") ?? "").trim();
  const motivoBloqueio = bloqueadoParaVenda && motivoBloqueioRaw ? motivoBloqueioRaw.slice(0, 300) : null;

  // Achado A6 da Parte 4 — mesmo padrão do par acima, causa DIFERENTE (ver
  // comentário em Cliente.bloqueadoParaFaturamento no schema).
  const bloqueadoParaFaturamento = formData.get("bloqueadoParaFaturamento") === "on";
  const motivoBloqueioFaturamentoRaw = String(formData.get("motivoBloqueioFaturamento") ?? "").trim();
  const motivoBloqueioFaturamento =
    bloqueadoParaFaturamento && motivoBloqueioFaturamentoRaw
      ? motivoBloqueioFaturamentoRaw.slice(0, 300)
      : null;

  try {
    await prisma.cliente.update({
      where: { id: clienteId },
      data: {
        nome,
        email: email || null,
        telefone: telefone || null,
        documento: documento || null,
        enderecoCep: enderecoCep || null,
        enderecoLogradouro: enderecoLogradouro || null,
        enderecoNumero: enderecoNumero || null,
        enderecoComplemento: enderecoComplemento || null,
        enderecoBairro: enderecoBairro || null,
        enderecoMunicipio: enderecoMunicipio || null,
        enderecoCodigoIbge: enderecoCodigoIbge || null,
        enderecoUf: enderecoUf || null,
        observacoes: observacoes || null,
        preferenciasProducao: preferenciasProducao || null,
        tipoPessoa: validacaoTipoPessoa.tipoPessoa,
        razaoSocial: razaoSocial || null,
        nomeFantasia: nomeFantasia || null,
        inscricaoEstadual: inscricaoEstadual || null,
        indicadorInscricaoEstadual: validacaoIndicadorIe.indicador,
        inscricaoMunicipal: inscricaoMunicipal || null,
        origem: validacaoOrigem.origem,
        origemOutro: validacaoOrigem.origemOutro,
        segmento: validacaoSegmento.segmento,
        segmentoOutro: validacaoSegmento.segmentoOutro,
        margemPadraoOverride: validacaoMargem.valor,
        vendedorId: validacaoVendedor.vendedorId,
        bloqueadoParaVenda,
        motivoBloqueio,
        limiteCredito: validacaoLimiteCredito.valor,
        prazoPagamentoPadraoDias: validacaoPrazoPagamento.valor,
        bloqueadoParaFaturamento,
        motivoBloqueioFaturamento,
        formaPagamentoPreferida: validacaoFormaPagamento.forma,
        descontoPadraoPercent: validacaoDescontoPadrao.valor,
        observacaoFinanceira: observacaoFinanceira || null,
      },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe um cliente cadastrado com esse CPF/CNPJ." };
    }
    throw erro;
  }

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${clienteId}`);
  revalidatePath("/orcamento");

  return { ok: true, mensagem: "Cliente atualizado com sucesso!" };
}

export type ExcluirClienteResult = { ok: boolean; mensagem: string };

export async function excluirCliente(
  _estadoAnterior: ExcluirClienteResult | null,
  formData: FormData
): Promise<ExcluirClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CLIENTES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar clientes." };
  }
  const clienteId = String(formData.get("clienteId"));

  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId: usuario.graficaId },
  });
  if (!cliente) {
    return { ok: false, mensagem: "Cliente não encontrado." };
  }

  try {
    await prisma.cliente.delete({ where: { id: clienteId } });
  } catch (erro) {
    if (ehViolacaoDeChaveEstrangeira(erro)) {
      return {
        ok: false,
        mensagem:
          'Este cliente tem orçamentos vinculados e não pode ser excluído. Use "Desativar" pra tirá-lo das listas mantendo o histórico intacto, ou "Anonimizar dados" se for um pedido de exclusão de dado pessoal (LGPD).',
      };
    }
    throw erro;
  }

  revalidatePath("/clientes");
  redirect("/clientes");
}

export type DesativarClienteResult = { ok: boolean; mensagem: string };

// Alternativa a excluirCliente pro caso mais comum: cliente com orçamento
// vinculado (é justamente quem já comprou que mais importa manter no
// histórico). Soft delete — marca desativadoEm em vez de apagar. Cliente
// some das listas e dos dropdowns de seleção (orçamento, produção,
// relatórios — ver filtro desativadoEm: null nessas queries), mas
// Orcamento/NotaFiscal continuam intactos e consultáveis. Reversível via
// reativarCliente. Mesmo precedente de desativarUsuario (src/app/usuarios/actions.ts).
export async function desativarCliente(
  _estadoAnterior: DesativarClienteResult | null,
  formData: FormData
): Promise<DesativarClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CLIENTES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar clientes." };
  }
  const clienteId = String(formData.get("clienteId"));

  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId: usuario.graficaId },
  });
  if (!cliente) {
    return { ok: false, mensagem: "Cliente não encontrado." };
  }
  if (cliente.desativadoEm) {
    return { ok: false, mensagem: "Este cliente já está desativado." };
  }

  await prisma.cliente.update({
    where: { id: clienteId },
    data: { desativadoEm: new Date() },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "cliente.desativar",
    entidade: "Cliente",
    entidadeId: cliente.id,
    descricao: `Cliente "${cliente.nome}" desativado`,
  });

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${clienteId}`);
  return { ok: true, mensagem: `Cliente "${cliente.nome}" desativado com sucesso.` };
}

export type ReativarClienteResult = { ok: boolean; mensagem: string };

// Reverso de desativarCliente: volta desativadoEm pra null. O cliente volta
// a aparecer nas listas e dropdowns.
export async function reativarCliente(
  _estadoAnterior: ReativarClienteResult | null,
  formData: FormData
): Promise<ReativarClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CLIENTES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar clientes." };
  }
  const clienteId = String(formData.get("clienteId"));

  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId: usuario.graficaId },
  });
  if (!cliente) {
    return { ok: false, mensagem: "Cliente não encontrado." };
  }
  if (!cliente.desativadoEm) {
    return { ok: false, mensagem: "Este cliente já está ativo." };
  }

  await prisma.cliente.update({
    where: { id: clienteId },
    data: { desativadoEm: null },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "cliente.reativar",
    entidade: "Cliente",
    entidadeId: cliente.id,
    descricao: `Cliente "${cliente.nome}" reativado`,
  });

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${clienteId}`);
  return { ok: true, mensagem: `Cliente "${cliente.nome}" reativado com sucesso.` };
}

export type AnonimizarClienteResult = { ok: boolean; mensagem: string };

// Caminho LGPD no lugar de "fale com o suporte": atende o direito de
// eliminação do titular sem violar a obrigação fiscal de retenção —
// Orcamento e NotaFiscal NUNCA são apagados ou desvinculados, só os dados
// de identificação/contato do Cliente em si são sobrescritos por
// marcadores. Também marca desativadoEm (some das listas). Ao contrário de
// desativarCliente, esta ação NÃO é reversível — o dado pessoal em si é
// destruído, não só escondido. Registrado em LogAuditoria (quem pediu, quem
// executou, quando), que é exatamente o rastro que esse tipo de ação exige.
export async function anonimizarCliente(
  _estadoAnterior: AnonimizarClienteResult | null,
  formData: FormData
): Promise<AnonimizarClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CLIENTES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar clientes." };
  }
  const clienteId = String(formData.get("clienteId"));

  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId: usuario.graficaId },
  });
  if (!cliente) {
    return { ok: false, mensagem: "Cliente não encontrado." };
  }

  const nomeOriginal = cliente.nome;

  await prisma.cliente.update({
    where: { id: clienteId },
    data: {
      nome: "Cliente removido",
      email: null,
      telefone: null,
      // documento fica null — NULL não colide com NULL no unique index
      // [graficaId, documento] (ver comentário no schema), então vários
      // clientes anonimizados da mesma gráfica convivem sem problema.
      documento: null,
      enderecoCep: null,
      enderecoLogradouro: null,
      enderecoNumero: null,
      enderecoComplemento: null,
      enderecoBairro: null,
      enderecoMunicipio: null,
      enderecoCodigoIbge: null,
      enderecoUf: null,
      desativadoEm: cliente.desativadoEm ?? new Date(),
    },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "cliente.anonimizar",
    entidade: "Cliente",
    entidadeId: cliente.id,
    descricao: `Dados pessoais de "${nomeOriginal}" anonimizados a pedido do titular (LGPD). Orçamentos e notas fiscais vinculados foram preservados (obrigação de retenção fiscal).`,
  });

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${clienteId}`);
  return {
    ok: true,
    mensagem: "Dados pessoais anonimizados com sucesso. Orçamentos e notas fiscais foram preservados.",
  };
}

// Achado A4 da Parte 5 da auditoria de abrangência — mesmo padrão
// enum-fechado+OUTRO de validarOrigem/validarSegmento acima. funcaoOutro só
// é obrigatório quando funcao=OUTRO. Sem seleção no formulário, cai no
// default do schema (COMPRADOR) — nunca fica ausente.
function validarFuncaoContato(
  formData: FormData
): { ok: true; funcao: FuncaoContatoCliente; funcaoOutro: string | null } | { ok: false; mensagem: string } {
  const funcao = String(formData.get("funcao") ?? "COMPRADOR").trim();
  if (!ORDEM_FUNCAO_CONTATO_CLIENTE.includes(funcao as FuncaoContatoCliente)) {
    return { ok: false, mensagem: "Função do contato inválida." };
  }
  if (funcao === "OUTRO") {
    const funcaoOutro = String(formData.get("funcaoOutro") ?? "").trim();
    if (!funcaoOutro) {
      return { ok: false, mensagem: 'Descreva a função quando escolher "Outro".' };
    }
    return { ok: true, funcao: "OUTRO", funcaoOutro };
  }
  return { ok: true, funcao: funcao as FuncaoContatoCliente, funcaoOutro: null };
}

export type ContatoClienteResult = { ok: boolean; mensagem: string };

// Cadastro de contato individual de um Cliente Pessoa Jurídica (achado A4 da
// Parte 5 da auditoria de abrangência) — quem compra != quem aprova arte !=
// financeiro != recebimento. Não substitui Cliente.email/telefone, que
// continuam funcionando exatamente como hoje pra quem não usa contatos.
export async function criarContatoCliente(
  _estadoAnterior: ContatoClienteResult | null,
  formData: FormData
): Promise<ContatoClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CLIENTES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar clientes." };
  }
  const clienteId = String(formData.get("clienteId"));

  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId: usuario.graficaId },
  });
  if (!cliente) {
    return { ok: false, mensagem: "Cliente não encontrado." };
  }

  const parsed = contatoClienteSchema.safeParse({
    nome: formData.get("nome"),
    cargo: formData.get("cargo"),
    departamento: formData.get("departamento"),
    email: formData.get("email"),
    telefone: formData.get("telefone"),
    whatsapp: formData.get("whatsapp"),
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const validacaoFuncao = validarFuncaoContato(formData);
  if (!validacaoFuncao.ok) {
    return validacaoFuncao;
  }

  const { nome, cargo, departamento, email, telefone, whatsapp } = parsed.data;
  const principal = formData.get("principal") === "on";

  // Só um contato principal por cliente (regra de aplicação, ver comentário
  // no schema) — desmarca qualquer outro principal do mesmo cliente antes de
  // marcar este, dentro da mesma transação pra não deixar 2 principais
  // simultâneos em caso de corrida.
  await prisma.$transaction(async (tx) => {
    if (principal) {
      await tx.contatoCliente.updateMany({
        where: { clienteId, principal: true },
        data: { principal: false },
      });
    }
    await tx.contatoCliente.create({
      data: {
        clienteId,
        nome,
        cargo: cargo || null,
        departamento: departamento || null,
        email: email || null,
        telefone: telefone || null,
        whatsapp: whatsapp || null,
        funcao: validacaoFuncao.funcao,
        funcaoOutro: validacaoFuncao.funcaoOutro,
        principal,
      },
    });
  });

  revalidatePath(`/clientes/${clienteId}`);

  return { ok: true, mensagem: `Contato "${nome}" adicionado.` };
}

export async function atualizarContatoCliente(
  _estadoAnterior: ContatoClienteResult | null,
  formData: FormData
): Promise<ContatoClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CLIENTES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar clientes." };
  }
  const contatoId = String(formData.get("contatoId"));

  // Junta com Cliente pra confirmar que o contato pertence à MESMA gráfica —
  // ContatoCliente não tem graficaId próprio (escopado só por clienteId),
  // mesmo precedente de CreditoCliente/MovimentacaoCreditoCliente no schema.
  const contato = await prisma.contatoCliente.findFirst({
    where: { id: contatoId, cliente: { graficaId: usuario.graficaId } },
  });
  if (!contato) {
    return { ok: false, mensagem: "Contato não encontrado." };
  }

  const parsed = contatoClienteSchema.safeParse({
    nome: formData.get("nome"),
    cargo: formData.get("cargo"),
    departamento: formData.get("departamento"),
    email: formData.get("email"),
    telefone: formData.get("telefone"),
    whatsapp: formData.get("whatsapp"),
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const validacaoFuncao = validarFuncaoContato(formData);
  if (!validacaoFuncao.ok) {
    return validacaoFuncao;
  }

  const { nome, cargo, departamento, email, telefone, whatsapp } = parsed.data;
  const principal = formData.get("principal") === "on";

  await prisma.$transaction(async (tx) => {
    if (principal) {
      await tx.contatoCliente.updateMany({
        where: { clienteId: contato.clienteId, principal: true, id: { not: contatoId } },
        data: { principal: false },
      });
    }
    await tx.contatoCliente.update({
      where: { id: contatoId },
      data: {
        nome,
        cargo: cargo || null,
        departamento: departamento || null,
        email: email || null,
        telefone: telefone || null,
        whatsapp: whatsapp || null,
        funcao: validacaoFuncao.funcao,
        funcaoOutro: validacaoFuncao.funcaoOutro,
        principal,
      },
    });
  });

  revalidatePath(`/clientes/${contato.clienteId}`);

  return { ok: true, mensagem: `Contato "${nome}" atualizado.` };
}

// Soft-delete — nunca hard delete, o contato pode já estar referenciado por
// Orcamento.contatoClienteId (histórico de orçamento passado não pode
// quebrar). Contato desativado some do <select> de novos orçamentos (ver
// ContatoSelectOrcamento), mas continua existindo e reversível.
export async function desativarContatoCliente(
  _estadoAnterior: ContatoClienteResult | null,
  formData: FormData
): Promise<ContatoClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CLIENTES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar clientes." };
  }
  const contatoId = String(formData.get("contatoId"));

  const contato = await prisma.contatoCliente.findFirst({
    where: { id: contatoId, cliente: { graficaId: usuario.graficaId } },
  });
  if (!contato) {
    return { ok: false, mensagem: "Contato não encontrado." };
  }

  await prisma.contatoCliente.update({
    where: { id: contatoId },
    data: { ativo: false },
  });

  revalidatePath(`/clientes/${contato.clienteId}`);

  return { ok: true, mensagem: `Contato "${contato.nome}" desativado.` };
}

// Reverso de desativarContatoCliente — mesmo precedente reversível de
// reativarCliente acima.
export async function reativarContatoCliente(
  _estadoAnterior: ContatoClienteResult | null,
  formData: FormData
): Promise<ContatoClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CLIENTES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar clientes." };
  }
  const contatoId = String(formData.get("contatoId"));

  const contato = await prisma.contatoCliente.findFirst({
    where: { id: contatoId, cliente: { graficaId: usuario.graficaId } },
  });
  if (!contato) {
    return { ok: false, mensagem: "Contato não encontrado." };
  }

  await prisma.contatoCliente.update({
    where: { id: contatoId },
    data: { ativo: true },
  });

  revalidatePath(`/clientes/${contato.clienteId}`);

  return { ok: true, mensagem: `Contato "${contato.nome}" reativado.` };
}
