"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import {
  carregarDadosExemplo,
  limparDadosExemplo,
  gerarOrcamentoExemplo,
} from "@/lib/dados-exemplo";

// /comecar não tem gate de módulo (é a única tela que todo usuário autenticado
// sempre acessa — ver comentário de exigirVerModulo em src/lib/auth/permissoes.ts),
// então as ações desta tela seguem só a tripla de auth da página, sem
// podeEditarModulo — mesmo padrão da própria page.tsx.

export type CarregarDadosExemploResult = { ok: boolean; mensagem: string };

export async function carregarDadosExemploAction(
  _estadoAnterior: CarregarDadosExemploResult | null,
  _formData: FormData
): Promise<CarregarDadosExemploResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);

  const resultado = await carregarDadosExemplo(usuario.graficaId);
  if (!resultado.ok) {
    return { ok: false, mensagem: resultado.mensagem };
  }

  revalidatePath("/comecar");
  revalidatePath("/catalogo");
  revalidatePath("/configuracoes/prensas");

  return {
    ok: true,
    mensagem: resultado.jaCarregado
      ? "Os dados de exemplo já estavam carregados."
      : "Dados de exemplo carregados! Já dá pra gerar um orçamento de teste.",
  };
}

export type LimparDadosExemploResult = { ok: boolean; mensagem: string };

export async function limparDadosExemploAction(
  _estadoAnterior: LimparDadosExemploResult | null,
  _formData: FormData
): Promise<LimparDadosExemploResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);

  const resultado = await limparDadosExemplo(usuario.graficaId);

  updateTag(`uso-${usuario.graficaId}`); // pode ter removido orçamento de exemplo (ver src/lib/billing/uso.ts)
  revalidatePath("/comecar");
  revalidatePath("/catalogo");
  revalidatePath("/configuracoes/prensas");
  revalidatePath("/orcamento");

  return resultado;
}

export type GerarOrcamentoExemploResult = { ok: boolean; mensagem: string };

// Sucesso não retorna estado — redireciona direto pro orçamento criado, mesmo
// padrão de criarOrcamento (src/app/orcamento/actions.ts) e criarPrensa
// (src/app/configuracoes/prensas/actions.ts): a Server Action navega, o
// componente cliente só precisa tratar o caminho de erro.
export async function gerarOrcamentoExemploAction(
  _estadoAnterior: GerarOrcamentoExemploResult | null,
  _formData: FormData
): Promise<GerarOrcamentoExemploResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);

  const resultado = await gerarOrcamentoExemplo(usuario.graficaId, usuario.id);
  if (!resultado.ok) {
    return { ok: false, mensagem: resultado.mensagem };
  }

  updateTag(`uso-${usuario.graficaId}`); // orçamento novo muda a contagem do mês (ver src/lib/billing/uso.ts)
  revalidatePath("/comecar");
  revalidatePath("/catalogo");
  revalidatePath("/configuracoes/prensas");
  revalidatePath("/orcamento");
  redirect(`/orcamento/${resultado.orcamentoId}`);
}
