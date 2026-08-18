"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";
import { listarPendenciasConfiguracao, type PendenciaConfiguracao } from "@/lib/pendencias-configuracao";

// Refile default — mesmo valor já usado como ponto de partida em
// BobinasEditor (ConfiguracaoProdutoForm.tsx) quando o usuário adiciona uma
// bobina manualmente. Editável depois em Configurações do produto se
// precisar de um valor diferente; aqui só destrava o motor de preço.
const REFILE_PADRAO = 0.02;

// Só DONO vê pendência — checado aqui, no servidor, nunca confiando num
// prop client-side (regra permanente do projeto: tudo sensível é
// re-derivado da sessão, nunca confiado no que chega do cliente).
export async function obterPendenciasConfiguracao(): Promise<PendenciaConfiguracao[]> {
  const usuario = await exigirUsuarioAutenticado();
  if (usuario.papel !== "DONO") return [];
  return listarPendenciasConfiguracao(usuario.graficaId);
}

export type ResponderPendenciaResult = { ok: boolean; mensagem: string };

// Ação pequena e dedicada — de propósito NÃO reaproveita salvarModeloProduto
// (catalogo/[itemGraficaId]/actions.ts): aquela salva o modelo M2 inteiro e
// zera custoImpressaoM2/areaMinimaFaturavel se não vierem no FormData, o que
// apagaria configuração já existente vinda de um form que só pergunta a
// largura da bobina.
export async function responderPendenciaBobina(
  _estadoAnterior: ResponderPendenciaResult | null,
  formData: FormData
): Promise<ResponderPendenciaResult> {
  const usuario = await exigirUsuarioAutenticado();
  if (usuario.papel !== "DONO") {
    return { ok: false, mensagem: "Só o Dono pode resolver essa pendência." };
  }
  if (!(await podeEditarModulo(usuario, "CATALOGO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o catálogo." };
  }

  const itemGraficaId = String(formData.get("itemGraficaId") || "");
  const larguraNominal = Number(formData.get("larguraNominal"));
  if (!Number.isFinite(larguraNominal) || larguraNominal <= 0) {
    return { ok: false, mensagem: "Largura da bobina inválida." };
  }

  const itemGrafica = await prisma.itemGrafica.findFirst({
    where: { id: itemGraficaId, graficaId: usuario.graficaId, modeloCalculo: "M2" },
    include: { itemCatalogo: true },
  });
  if (!itemGrafica) {
    return { ok: false, mensagem: "Produto não encontrado." };
  }

  await prisma.bobinaMaterial.create({
    data: { itemGraficaId, larguraNominal, refile: REFILE_PADRAO },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "catalogo.resolver_pendencia_bobina",
    entidade: "ItemGrafica",
    entidadeId: itemGraficaId,
    descricao: `Bobina configurada via questionário de pendências para "${itemGrafica.itemCatalogo.nome}"`,
    valorAnterior: "sem bobina",
    valorNovo: `largura ${larguraNominal}m`,
  });

  revalidatePath(`/catalogo/${itemGraficaId}`);
  revalidatePath("/catalogo");
  return { ok: true, mensagem: "Bobina configurada!" };
}
