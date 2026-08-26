"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { validarWebhookUrl } from "@/lib/webhook-assistente";
import { registrarAuditoria, criarDiffCampos } from "@/lib/auditoria";

export type SalvarAutomacaoResult = { ok: boolean; mensagem: string };

export async function salvarAutomacao(
  _estadoAnterior: SalvarAutomacaoResult | null,
  formData: FormData
): Promise<SalvarAutomacaoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  // Campo write-only: em branco = "manter o valor salvo" (nunca reexibimos a
  // URL completa no formulário, só o domínio — ver page.tsx).
  const novaUrl = formData.get("webhookUrl");
  let webhookUrlParaSalvar: string | undefined;
  if (typeof novaUrl === "string" && novaUrl.trim()) {
    const validacao = validarWebhookUrl(novaUrl.trim());
    if (!validacao.ok) {
      return { ok: false, mensagem: validacao.mensagem ?? "URL inválida." };
    }
    webhookUrlParaSalvar = novaUrl.trim();
  }

  // Checkbox desmarcado não aparece no FormData — ausência = false.
  const notificarStatusMudou = formData.get("notificarStatusMudou") === "on";
  const notificarEstoqueCritico = formData.get("notificarEstoqueCritico") === "on";
  const notificarPedidoAtrasado = formData.get("notificarPedidoAtrasado") === "on";

  const antes = await prisma.automacaoGrafica.findUnique({
    where: { graficaId: usuario.graficaId },
  });

  await prisma.automacaoGrafica.upsert({
    where: { graficaId: usuario.graficaId },
    update: {
      ...(webhookUrlParaSalvar !== undefined ? { webhookUrl: webhookUrlParaSalvar } : {}),
      notificarStatusMudou,
      notificarEstoqueCritico,
      notificarPedidoAtrasado,
    },
    create: {
      graficaId: usuario.graficaId,
      ...(webhookUrlParaSalvar !== undefined ? { webhookUrl: webhookUrlParaSalvar } : {}),
      notificarStatusMudou,
      notificarEstoqueCritico,
      notificarPedidoAtrasado,
    },
  });

  // webhookUrl é tratada como segredo (mesmo cuidado do schema.prisma:646-649
  // e do form, que nunca reexibe a URL completa) — o log NUNCA grava o valor,
  // só que ela foi alterada. Os 3 booleans de notificação não são segredo e
  // entram no diff normalmente (achado A3 da auditoria de abrangência,
  // 2026-08-24).
  // Defaults do schema (AutomacaoGrafica) são todos `true`, não `false` —
  // usados aqui só pro fallback de "linha ainda não existia" (create), pra
  // não logar um falso "estava desligado" na primeira vez que a gráfica salva.
  const diff = criarDiffCampos();
  diff.campo(
    "Notificar mudança de status",
    antes?.notificarStatusMudou ?? true,
    notificarStatusMudou
  );
  diff.campo(
    "Notificar estoque crítico",
    antes?.notificarEstoqueCritico ?? true,
    notificarEstoqueCritico
  );
  diff.campo(
    "Notificar pedido atrasado",
    antes?.notificarPedidoAtrasado ?? true,
    notificarPedidoAtrasado
  );
  if (webhookUrlParaSalvar !== undefined) {
    diff.antesTextos.push(`Webhook: ${antes?.webhookUrl ? "configurado" : "—"}`);
    diff.depoisTextos.push("Webhook: alterado");
  }
  if (diff.temMudanca) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.salvar_automacao",
      entidade: "AutomacaoGrafica",
      entidadeId: usuario.graficaId,
      descricao: "Configuração de automação atualizada",
      valorAnterior: diff.antesTextos.join("; "),
      valorNovo: diff.depoisTextos.join("; "),
    });
  }

  revalidatePath("/configuracoes/automacao");
  return { ok: true, mensagem: "Automação salva com sucesso!" };
}
