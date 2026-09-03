"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria, criarDiffCampos } from "@/lib/auditoria";
import { garantirEtapasGraficaPadrao, ETAPAS_SEMPRE_ATIVAS } from "@/lib/etapa-grafica";
import { SEQUENCIA_STATUS_PEDIDO, ROTULOS_STATUS_PEDIDO } from "@/lib/producao-estagios";
import type { StatusPedido } from "@/generated/prisma/enums";

export type SalvarEtapasGraficaResult = { ok: boolean; mensagem: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar configurações.";

// Salva as 8 linhas de EtapaGrafica de uma vez (ativa/rótulo/ordem) — não
// existe "criar"/"excluir" nesta tela (as 8 linhas são fixas, uma por
// StatusPedido exceto CANCELADO, ver comentário do model no schema), só
// "atualizar todas juntas", mesmo espírito do form em grade de
// ResponsaveisEstagioForm.tsx (um <form> só, um botão "Salvar" só).
export async function salvarEtapasGrafica(
  _estadoAnterior: SalvarEtapasGraficaResult | null,
  formData: FormData
): Promise<SalvarEtapasGraficaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  // Bootstrap lazy — garante que as 8 linhas já existem antes de tentar
  // atualizar (mesmo padrão de leitura em resolverEtapasGrafica/
  // garantirCategoriasCustoPadrao).
  await garantirEtapasGraficaPadrao(usuario.graficaId);

  const antes = await prisma.etapaGrafica.findMany({ where: { graficaId: usuario.graficaId } });
  const antesPorStatus = new Map(antes.map((etapa) => [etapa.status, etapa]));

  const novas: { status: StatusPedido; ativa: boolean; rotulo: string | null; ordem: number }[] = [];
  for (const status of SEQUENCIA_STATUS_PEDIDO) {
    // ARTE/PRODUCAO/ENTREGUE NUNCA podem ficar inativas (ver
    // ETAPAS_SEMPRE_ATIVAS em src/lib/etapa-grafica.ts pro motivo de cada
    // uma) — validado aqui, não só desabilitado na UI. Cobre também o
    // navegador: um checkbox `disabled` não é enviado no FormData, então
    // sem esta trava explícita as 3 etapas ficariam ativa=false por
    // omissão em vez de permanecerem sempre ligadas.
    const ativa = ETAPAS_SEMPRE_ATIVAS.includes(status)
      ? true
      : formData.get(`ativa_${status}`) === "on";

    const rotuloBruto = String(formData.get(`rotulo_${status}`) ?? "").trim();
    // "" volta a usar o rótulo padrão do sistema (rotulo=null), nunca grava
    // string vazia — mesma semântica de "sem override" em qualquer outro
    // campo opcional do projeto.
    const rotulo = rotuloBruto.length > 0 ? rotuloBruto : null;

    const ordemBruta = Number(formData.get(`ordem_${status}`));
    const ordem = Number.isFinite(ordemBruta)
      ? Math.trunc(ordemBruta)
      : (antesPorStatus.get(status)?.ordem ?? SEQUENCIA_STATUS_PEDIDO.indexOf(status));

    novas.push({ status, ativa, rotulo, ordem });
  }

  await prisma.$transaction(
    novas.map((linha) =>
      prisma.etapaGrafica.update({
        where: { graficaId_status: { graficaId: usuario.graficaId, status: linha.status } },
        data: { ativa: linha.ativa, rotulo: linha.rotulo, ordem: linha.ordem },
      })
    )
  );

  // Auditoria campo-a-campo (mesmo padrão de criarDiffCampos usado no resto
  // de Configurações) — só registra o que de fato mudou, rotulado pelo
  // nome PADRÃO da etapa (não o customizado, que pode estar mudando na
  // própria linha do diff).
  const diff = criarDiffCampos();
  for (const linha of novas) {
    const anterior = antesPorStatus.get(linha.status);
    if (!anterior) continue;
    const nomeEtapa = ROTULOS_STATUS_PEDIDO[linha.status];
    diff.campo(`${nomeEtapa} — ativa`, anterior.ativa, linha.ativa);
    diff.campo(`${nomeEtapa} — rótulo`, anterior.rotulo, linha.rotulo);
    diff.campo(`${nomeEtapa} — ordem`, anterior.ordem, linha.ordem);
  }

  if (diff.temMudanca) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.salvar_etapas_producao",
      entidade: "Grafica",
      entidadeId: usuario.graficaId,
      descricao: "Etapas de produção atualizadas",
      valorAnterior: diff.antesTextos.join("; "),
      valorNovo: diff.depoisTextos.join("; "),
    });
  }

  revalidatePath("/configuracoes/etapas-producao");
  revalidatePath("/producao");
  revalidatePath("/usuarios");
  return { ok: true, mensagem: "Etapas de produção atualizadas." };
}
