"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { RegimeTributario } from "@/generated/prisma/enums";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria, criarDiffCampos } from "@/lib/auditoria";

export type SalvarFilialResult = { ok: boolean; mensagem: string };

export async function criarFilial(
  _estadoAnterior: SalvarFilialResult | null,
  formData: FormData
): Promise<SalvarFilialResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: "Informe um nome para a filial." };
  }

  let novaFilial: { id: string };
  try {
    novaFilial = await prisma.filial.create({
      data: { graficaId: usuario.graficaId, nome },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe uma filial com esse nome." };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.criar_filial",
    entidade: "Filial",
    entidadeId: novaFilial.id,
    descricao: `Filial "${nome}" criada`,
  });

  revalidatePath("/configuracoes/filiais");
  redirect(`/configuracoes/filiais/${novaFilial.id}`);
}

export async function salvarFilial(
  _estadoAnterior: SalvarFilialResult | null,
  formData: FormData
): Promise<SalvarFilialResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const filialId = String(formData.get("filialId"));

  const filial = await prisma.filial.findFirst({
    where: { id: filialId, graficaId: usuario.graficaId },
  });
  if (!filial) {
    return { ok: false, mensagem: "Filial não encontrada." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: "Informe um nome para a filial." };
  }
  const enderecoBruto = String(formData.get("endereco") ?? "").trim();
  const endereco = enderecoBruto || null;
  const ativa = formData.get("ativa") === "on";

  try {
    await prisma.filial.update({
      where: { id: filialId },
      data: { nome, endereco, ativa },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe uma filial com esse nome." };
    }
    throw erro;
  }

  const diff = criarDiffCampos();
  diff.campo("Nome", filial.nome, nome);
  diff.campo("Endereço", filial.endereco, endereco);
  diff.campo("Ativa", filial.ativa, ativa);
  if (diff.temMudanca) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.salvar_filial",
      entidade: "Filial",
      entidadeId: filialId,
      descricao: `Filial "${filial.nome}" atualizada`,
      valorAnterior: diff.antesTextos.join("; "),
      valorNovo: diff.depoisTextos.join("; "),
    });
  }

  revalidatePath(`/configuracoes/filiais/${filialId}`);
  revalidatePath("/configuracoes/filiais");
  return { ok: true, mensagem: "Filial salva com sucesso!" };
}

export type SalvarDadosFiscaisFilialResult = { ok: boolean; mensagem: string };

// Mesmos campos de src/app/configuracoes/fiscal/actions.ts (salvarDadosFiscais)
// — DadosFiscaisFilial espelha DadosFiscaisGrafica campo a campo.
const CAMPOS_TEXTO_FISCAL = [
  "cnpj",
  "razaoSocial",
  "nomeFantasia",
  "inscricaoEstadual",
  "enderecoCep",
  "enderecoLogradouro",
  "enderecoNumero",
  "enderecoBairro",
  "enderecoMunicipio",
  "enderecoUf",
  "naturezaOperacaoPadrao",
  "cfopPadrao",
  "cfopPadraoInterestadual",
  "csosnPadrao",
  "cstIcmsPadrao",
  "icmsModalidadeBaseCalculoPadrao",
  "pisCofinsSituacaoTributariaPadrao",
] as const;

const REGIMES_TRIBUTARIOS_FILIAL: RegimeTributario[] = ["SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL"];

// Mesmos rótulos de src/app/configuracoes/fiscal/actions.ts — duplicado de
// propósito, no mesmo espírito de CAMPOS_TEXTO_FISCAL acima (espelha
// DadosFiscaisGrafica campo a campo, mas é uma tela própria).
const ROTULO_CAMPO_FISCAL_FILIAL: Record<(typeof CAMPOS_TEXTO_FISCAL)[number], string> = {
  cnpj: "CNPJ",
  razaoSocial: "Razão social",
  nomeFantasia: "Nome fantasia",
  inscricaoEstadual: "Inscrição estadual",
  enderecoCep: "CEP",
  enderecoLogradouro: "Logradouro",
  enderecoNumero: "Número",
  enderecoBairro: "Bairro",
  enderecoMunicipio: "Município",
  enderecoUf: "UF",
  naturezaOperacaoPadrao: "Natureza da operação padrão",
  cfopPadrao: "CFOP padrão",
  cfopPadraoInterestadual: "CFOP padrão interestadual",
  csosnPadrao: "CSOSN padrão",
  cstIcmsPadrao: "CST-ICMS padrão",
  icmsModalidadeBaseCalculoPadrao: "Modalidade de base de cálculo do ICMS padrão",
  pisCofinsSituacaoTributariaPadrao: "Situação tributária de PIS/COFINS padrão",
};
const ROTULO_AMBIENTE_FILIAL: Record<string, string> = {
  homologacao: "Homologação (testes)",
  producao: "Produção",
};
const ROTULO_REGIME_TRIBUTARIO_FILIAL: Record<RegimeTributario, string> = {
  SIMPLES_NACIONAL: "Simples Nacional",
  LUCRO_PRESUMIDO: "Lucro Presumido",
  LUCRO_REAL: "Lucro Real",
};
// Mesmo cuidado de fiscal/actions.ts: 3 dos CAMPOS_TEXTO_FISCAL têm @default
// no schema (DadosFiscaisFilial espelha DadosFiscaisGrafica) — fallback só
// usado quando a filial nunca teve dados fiscais próprios configurados.
const DEFAULT_CAMPO_TEXTO_FISCAL_FILIAL: Partial<Record<(typeof CAMPOS_TEXTO_FISCAL)[number], string>> = {
  naturezaOperacaoPadrao: "Venda de mercadoria",
  cfopPadrao: "5102",
  cfopPadraoInterestadual: "6102",
  csosnPadrao: "102",
};

// Opcional por natureza: só existe linha em DadosFiscaisFilial quando a
// filial de fato tem CNPJ próprio configurado (ver resolverDadosFiscais em
// src/lib/nota-fiscal.ts) — sem isso, a emissão de nota continua usando os
// dados fiscais da gráfica, comportamento de sempre.
export async function salvarDadosFiscaisFilial(
  _estadoAnterior: SalvarDadosFiscaisFilialResult | null,
  formData: FormData
): Promise<SalvarDadosFiscaisFilialResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const filialId = String(formData.get("filialId"));

  // Isolamento de tenant: a filial precisa ser da própria gráfica do usuário
  // logado antes de mexer no cadastro fiscal dela.
  const filial = await prisma.filial.findFirst({
    where: { id: filialId, graficaId: usuario.graficaId },
  });
  if (!filial) {
    return { ok: false, mensagem: "Filial não encontrada." };
  }

  const ambiente = formData.get("ambiente");
  if (ambiente !== "homologacao" && ambiente !== "producao") {
    return { ok: false, mensagem: "Ambiente inválido." };
  }

  const regimeTributarioBruto = formData.get("regimeTributario");
  if (
    typeof regimeTributarioBruto !== "string" ||
    !REGIMES_TRIBUTARIOS_FILIAL.includes(regimeTributarioBruto as RegimeTributario)
  ) {
    return { ok: false, mensagem: "Regime tributário inválido." };
  }
  const regimeTributario = regimeTributarioBruto as RegimeTributario;

  const dados: Record<string, string | null> = { ambiente };

  for (const campo of CAMPOS_TEXTO_FISCAL) {
    const valor = formData.get(campo);
    dados[campo] = typeof valor === "string" && valor.trim() ? valor.trim() : null;
  }

  // CEP alimenta a emissão de nota fiscal de verdade (Focus NFe) — falhar
  // aqui, com mensagem clara, é melhor que só descobrir na hora de emitir.
  if (dados.enderecoCep && !/^\d{5}-?\d{3}$/.test(dados.enderecoCep)) {
    return { ok: false, mensagem: "CEP inválido — use o formato 00000-000." };
  }

  // Alíquota é Decimal, não passa pelo loop de texto acima — parse numérico
  // à parte, com a mesma regra de "em branco = null".
  const icmsAliquotaBruta = formData.get("icmsAliquotaPadrao");
  let icmsAliquotaPadrao: number | null = null;
  if (typeof icmsAliquotaBruta === "string" && icmsAliquotaBruta.trim()) {
    const numero = Number(icmsAliquotaBruta);
    if (Number.isNaN(numero) || numero < 0 || numero > 100) {
      return { ok: false, mensagem: "Alíquota de ICMS inválida — use um percentual entre 0 e 100." };
    }
    icmsAliquotaPadrao = numero;
  }

  // Fora do Simples Nacional a nota usa CST-ICMS (não CSOSN) e precisa de
  // alíquota/base/modalidade de cálculo — bloqueia salvar sem os 4 campos
  // em vez de deixar a emissão falhar depois na Focus NFe/SEFAZ.
  if (regimeTributario !== "SIMPLES_NACIONAL") {
    const faltando: string[] = [];
    if (!dados.cstIcmsPadrao) faltando.push("CST-ICMS padrão");
    if (icmsAliquotaPadrao === null) faltando.push("alíquota de ICMS padrão");
    if (!dados.icmsModalidadeBaseCalculoPadrao) faltando.push("modalidade de base de cálculo do ICMS padrão");
    if (!dados.pisCofinsSituacaoTributariaPadrao) faltando.push("situação tributária de PIS/COFINS padrão");
    if (faltando.length > 0) {
      return {
        ok: false,
        mensagem: `Regime tributário fora do Simples Nacional exige a configuração de: ${faltando.join(", ")}.`,
      };
    }
  }

  // Campo de token é write-only: em branco = "manter o valor salvo" (nunca
  // reexibimos o token de verdade no formulário, só os últimos 4 caracteres).
  const novoToken = formData.get("focusNfeToken");
  const tokenAlterado = typeof novoToken === "string" && novoToken.trim().length > 0;
  if (tokenAlterado) {
    dados.focusNfeToken = novoToken.trim();
  }

  const dadosAntes = await prisma.dadosFiscaisFilial.findUnique({ where: { filialId } });

  await prisma.dadosFiscaisFilial.upsert({
    where: { filialId },
    update: { ...dados, regimeTributario, icmsAliquotaPadrao },
    create: { filialId, ...dados, regimeTributario, icmsAliquotaPadrao },
  });

  // Mesmo cuidado de src/app/configuracoes/fiscal/actions.ts: dados fiscais
  // alimentam a emissão de NF-e de verdade, e o token NUNCA entra no diff
  // pelo valor — só "alterado".
  const diff = criarDiffCampos();
  diff.campo(
    "Ambiente",
    ROTULO_AMBIENTE_FILIAL[dadosAntes?.ambiente ?? "homologacao"],
    ROTULO_AMBIENTE_FILIAL[ambiente]
  );
  diff.campo(
    "Regime tributário",
    ROTULO_REGIME_TRIBUTARIO_FILIAL[dadosAntes?.regimeTributario ?? "SIMPLES_NACIONAL"],
    ROTULO_REGIME_TRIBUTARIO_FILIAL[regimeTributario]
  );
  const icmsAliquotaAntes = dadosAntes?.icmsAliquotaPadrao != null ? Number(dadosAntes.icmsAliquotaPadrao) : null;
  diff.campo("Alíquota de ICMS padrão (%)", icmsAliquotaAntes, icmsAliquotaPadrao);
  for (const campo of CAMPOS_TEXTO_FISCAL) {
    const antesCampo = dadosAntes?.[campo] ?? DEFAULT_CAMPO_TEXTO_FISCAL_FILIAL[campo] ?? null;
    diff.campo(ROTULO_CAMPO_FISCAL_FILIAL[campo], antesCampo, dados[campo]);
  }
  if (tokenAlterado) {
    diff.antesTextos.push("Token Focus NFe: (existente)");
    diff.depoisTextos.push("Token Focus NFe: alterado");
  }
  if (diff.temMudanca) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.salvar_dados_fiscais_filial",
      entidade: "DadosFiscaisFilial",
      entidadeId: filialId,
      descricao: `Dados fiscais da filial "${filial.nome}" atualizados`,
      valorAnterior: diff.antesTextos.join("; "),
      valorNovo: diff.depoisTextos.join("; "),
    });
  }

  revalidatePath(`/configuracoes/filiais/${filialId}`);
  return { ok: true, mensagem: "Dados fiscais da filial salvos com sucesso!" };
}

// Sempre permitida (ao contrário de excluirPrensa) — Orcamento.filialId é
// onDelete: SetNull, então excluir uma filial só desvincula os orçamentos
// antigos dela (viram "sem filial"), nunca bloqueia por causa de histórico.
// Fechar uma filial não deveria travar limpeza de cadastro.
export async function excluirFilial(
  _estadoAnterior: SalvarFilialResult | null,
  formData: FormData
): Promise<SalvarFilialResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const filialId = String(formData.get("filialId"));

  const filial = await prisma.filial.findFirst({
    where: { id: filialId, graficaId: usuario.graficaId },
  });
  if (!filial) {
    return { ok: false, mensagem: "Filial não encontrada." };
  }

  await prisma.filial.delete({ where: { id: filialId } });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.excluir_filial",
    entidade: "Filial",
    entidadeId: filialId,
    descricao: `Filial "${filial.nome}" excluída`,
  });

  revalidatePath("/configuracoes/filiais");
  redirect("/configuracoes/filiais");
}
