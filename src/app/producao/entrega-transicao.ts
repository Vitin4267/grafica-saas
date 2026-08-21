import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { TRANSICOES_VALIDAS, ROTULOS_STATUS_ENTREGA, type StatusEntrega } from "@/lib/entrega-status";

// Núcleo da transição de status de uma Entrega — mesma filosofia de
// avancarStatusCompra (src/app/compras/status-transicao.ts) e
// avancarStatusPedido (src/app/producao/status-transicao.ts): não faz
// autenticação/autorização (responsabilidade de quem chama, ver
// ./entrega-actions.ts), só valida a transição em si e aplica os efeitos
// colaterais de cada etapa (motorista, dataSaida/dataEntrega,
// observações).

export type EntregaParaTransicao = {
  id: string;
  graficaId: string;
  status: StatusEntrega;
  motorista: string | null;
  dataSaida: Date | null;
  dataEntrega: Date | null;
  observacoes: string | null;
};

// Campos opcionais que o formulário de transição pode enviar junto —
// `undefined` = "não mexer nesse campo", `null` explícito (string vazia
// digitada) = "limpar", valor = grava. Mesmo contrato de
// DadosTransicaoCompra em src/app/compras/status-transicao.ts.
export type DadosTransicaoEntrega = {
  motorista?: string | null;
  observacoes?: string | null;
};

export type AvancarStatusEntregaResult =
  | {
      ok: true;
      mensagem: string;
      statusAnterior: StatusEntrega;
      proximoStatus: StatusEntrega;
    }
  | { ok: false; mensagem: string };

const MENSAGEM_CONFLITO =
  "Outra pessoa já alterou esta entrega — recarregue a página e confira o status atual.";

// PROBLEMA exige que o motivo seja registrado — sem isso, a tela mostraria
// "Problema" sem nenhum contexto do que de fato aconteceu (mesma ideia de
// exigir valorFinal antes de COMPRADO em compras/status-transicao.ts: uma
// transição sem o dado essencial dela é rejeitada antes de tocar o banco).
export async function avancarStatusEntrega(
  entrega: EntregaParaTransicao,
  proximoStatus: StatusEntrega,
  dados: DadosTransicaoEntrega = {}
): Promise<AvancarStatusEntregaResult> {
  const statusAnterior = entrega.status;

  if (!TRANSICOES_VALIDAS[statusAnterior].includes(proximoStatus)) {
    return {
      ok: false,
      mensagem: `Não é possível mudar de "${ROTULOS_STATUS_ENTREGA[statusAnterior]}" para "${ROTULOS_STATUS_ENTREGA[proximoStatus]}".`,
    };
  }

  const observacoesFinal = dados.observacoes !== undefined ? dados.observacoes : entrega.observacoes;
  if (proximoStatus === "PROBLEMA" && !observacoesFinal?.trim()) {
    return { ok: false, mensagem: "Descreva o problema antes de marcar a entrega como Problema." };
  }

  const dadosUpdate: Prisma.EntregaUpdateManyMutationInput = { status: proximoStatus };
  if (dados.motorista !== undefined) dadosUpdate.motorista = dados.motorista;
  if (dados.observacoes !== undefined) dadosUpdate.observacoes = dados.observacoes;

  // dataSaida/dataEntrega só são preenchidas na PRIMEIRA vez que a entrega
  // entra nesse status — nunca sobrescritas (ex: EM_TRANSITO → PROBLEMA →
  // EM_TRANSITO de novo não deveria resetar "quando de fato saiu"). Mesmo
  // princípio de CAMPO_DATA_POR_STATUS em compras/status-transicao.ts, só
  // que condicional em vez de incondicional porque aqui o mesmo status pode
  // ser reencontrado depois de um desvio por PROBLEMA.
  if (proximoStatus === "EM_TRANSITO" && entrega.dataSaida === null) {
    dadosUpdate.dataSaida = new Date();
  }
  if (proximoStatus === "ENTREGUE" && entrega.dataEntrega === null) {
    dadosUpdate.dataEntrega = new Date();
  }

  const resultado = await prisma.entrega.updateMany({
    where: { id: entrega.id, status: statusAnterior },
    data: dadosUpdate,
  });
  if (resultado.count === 0) {
    return { ok: false, mensagem: MENSAGEM_CONFLITO };
  }

  revalidatePath("/producao");

  return {
    ok: true,
    mensagem: `Entrega atualizada para "${ROTULOS_STATUS_ENTREGA[proximoStatus]}".`,
    statusAnterior,
    proximoStatus,
  };
}
