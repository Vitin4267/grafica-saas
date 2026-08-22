"use server";

import { revalidatePath } from "next/cache";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { combinarGrupoGangRun } from "@/lib/gang-run-servico";
import { formatoMoeda } from "@/lib/moeda";

export type CombinarGangRunActionResult =
  | { ok: true; mensagem: string }
  | { ok: false; mensagem: string };

// Ação manual do operador na tela /producao/gang-run: recebe os ids de
// FilaGangRun marcados (checkboxes do mesmo grupo, ver
// GrupoGangRunSelecao.tsx) e comita o rateio como CustoPedido real —
// combinarGrupoGangRun (src/lib/gang-run-servico.ts) já revalida
// compatibilidade física e status AGUARDANDO dentro da transação, esta
// action só cuida de auth/permissão e revalida a página depois.
export async function combinarGangRun(
  _estadoAnterior: CombinarGangRunActionResult | null,
  formData: FormData
): Promise<CombinarGangRunActionResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar a produção." };
  }

  const filaGangRunIds = formData.getAll("filaGangRunIds").map(String).filter(Boolean);
  if (filaGangRunIds.length < 2) {
    return { ok: false, mensagem: "Selecione ao menos dois itens pra combinar numa chapa." };
  }

  const resultado = await combinarGrupoGangRun({
    graficaId: usuario.graficaId,
    filaGangRunIds,
    combinadoPorId: usuario.id,
  });

  if (!resultado.ok) {
    return { ok: false, mensagem: resultado.mensagem };
  }

  revalidatePath("/producao/gang-run");
  revalidatePath("/producao");
  return {
    ok: true,
    mensagem: `Chapa combinada: ${resultado.itensCombinados} pedidos dividindo ${formatoMoeda.format(
      Number(resultado.custoTotal)
    )} de chapa + acerto.`,
  };
}
