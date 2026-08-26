"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { RegimeTributario } from "@/generated/prisma/enums";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria, criarDiffCampos } from "@/lib/auditoria";

export type SalvarDadosFiscaisResult = { ok: boolean; mensagem: string };

const CAMPOS_TEXTO = [
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

// Rótulos legíveis pro log de auditoria (ver achado A3 da auditoria de
// abrangência, 2026-08-24) — nenhum destes é segredo (diferente do token
// Focus NFe, tratado à parte), então o valor de verdade entra no log.
const ROTULO_CAMPO_FISCAL: Record<(typeof CAMPOS_TEXTO)[number], string> = {
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
const ROTULO_AMBIENTE: Record<string, string> = {
  homologacao: "Homologação (testes)",
  producao: "Produção",
};
const ROTULO_REGIME_TRIBUTARIO: Record<RegimeTributario, string> = {
  SIMPLES_NACIONAL: "Simples Nacional",
  LUCRO_PRESUMIDO: "Lucro Presumido",
  LUCRO_REAL: "Lucro Real",
};
// 3 dos CAMPOS_TEXTO têm @default no schema (os outros são nullable sem
// default) — usados só no fallback de "nunca configurado" (create) pro diff
// não acusar "— → 5102" quando na prática o valor efetivo já era 5102.
const DEFAULT_CAMPO_TEXTO_FISCAL: Partial<Record<(typeof CAMPOS_TEXTO)[number], string>> = {
  naturezaOperacaoPadrao: "Venda de mercadoria",
  cfopPadrao: "5102",
  cfopPadraoInterestadual: "6102",
  csosnPadrao: "102",
};

const REGIMES_TRIBUTARIOS: RegimeTributario[] = ["SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL"];

export async function salvarDadosFiscais(
  _estadoAnterior: SalvarDadosFiscaisResult | null,
  formData: FormData
): Promise<SalvarDadosFiscaisResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const ambiente = formData.get("ambiente");
  if (ambiente !== "homologacao" && ambiente !== "producao") {
    return { ok: false, mensagem: "Ambiente inválido." };
  }

  const regimeTributarioBruto = formData.get("regimeTributario");
  if (
    typeof regimeTributarioBruto !== "string" ||
    !REGIMES_TRIBUTARIOS.includes(regimeTributarioBruto as RegimeTributario)
  ) {
    return { ok: false, mensagem: "Regime tributário inválido." };
  }
  const regimeTributario = regimeTributarioBruto as RegimeTributario;

  const dados: Record<string, string | null> = { ambiente };

  for (const campo of CAMPOS_TEXTO) {
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

  const dadosAntes = await prisma.dadosFiscaisGrafica.findUnique({
    where: { graficaId: usuario.graficaId },
  });

  await prisma.dadosFiscaisGrafica.upsert({
    where: { graficaId: usuario.graficaId },
    update: { ...dados, regimeTributario, icmsAliquotaPadrao },
    create: { graficaId: usuario.graficaId, ...dados, regimeTributario, icmsAliquotaPadrao },
  });

  // Diff campo-a-campo — dados fiscais alimentam a emissão de NF-e de verdade
  // (Focus NFe/SEFAZ), então "quem trocou o CFOP" ou "quem mudou de
  // homologação pra produção" precisa ficar rastreável (achado A3 da
  // auditoria de abrangência, 2026-08-24). O TOKEN NUNCA entra no diff pelo
  // valor — só "alterado", nunca o valor em si, nem mascarado.
  const diff = criarDiffCampos();
  diff.campo(
    "Ambiente",
    ROTULO_AMBIENTE[dadosAntes?.ambiente ?? "homologacao"],
    ROTULO_AMBIENTE[ambiente]
  );
  diff.campo(
    "Regime tributário",
    ROTULO_REGIME_TRIBUTARIO[dadosAntes?.regimeTributario ?? "SIMPLES_NACIONAL"],
    ROTULO_REGIME_TRIBUTARIO[regimeTributario]
  );
  const icmsAliquotaAntes = dadosAntes?.icmsAliquotaPadrao != null ? Number(dadosAntes.icmsAliquotaPadrao) : null;
  diff.campo("Alíquota de ICMS padrão (%)", icmsAliquotaAntes, icmsAliquotaPadrao);
  for (const campo of CAMPOS_TEXTO) {
    const antesCampo = dadosAntes?.[campo] ?? DEFAULT_CAMPO_TEXTO_FISCAL[campo] ?? null;
    diff.campo(ROTULO_CAMPO_FISCAL[campo], antesCampo, dados[campo]);
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
      acao: "configuracoes.salvar_dados_fiscais",
      entidade: "DadosFiscaisGrafica",
      entidadeId: usuario.graficaId,
      descricao: "Dados fiscais da gráfica atualizados",
      valorAnterior: diff.antesTextos.join("; "),
      valorNovo: diff.depoisTextos.join("; "),
    });
  }

  revalidatePath("/configuracoes/fiscal");
  return { ok: true, mensagem: "Dados fiscais salvos com sucesso!" };
}
