import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  TRANSICOES_VALIDAS,
  ROTULOS_SITUACAO_TERCEIRIZACAO,
  type SituacaoTerceirizacao,
} from "@/lib/terceirizacao-status";
import { criarCustoAutomaticoTerceirizacao } from "@/lib/custo-pedido";

// Núcleo da transição de situação de uma EtapaTerceirizada — mesma
// filosofia de avancarStatusEntrega (src/app/producao/entrega-transicao.ts)
// e avancarStatusCompra (src/app/compras/status-transicao.ts): não faz
// autenticação/autorização (responsabilidade de quem chama, ver
// ./terceirizacao-actions.ts), só valida a transição em si e aplica os
// efeitos colaterais de cada etapa (fornecedor, datas, valores, e o
// CustoPedido automático quando valorFinal é preenchido — achado E1 da
// auditoria de abrangência).

export type EtapaTerceirizadaParaTransicao = {
  id: string;
  graficaId: string;
  pedidoId: string;
  situacao: SituacaoTerceirizacao;
  fornecedorId: string | null;
  fornecedorNome: string | null;
  enviadoEm: Date | null;
  previsaoRetorno: Date | null;
  retornadoEm: Date | null;
  valorAcordado: Prisma.Decimal | null;
  valorFinal: Prisma.Decimal | null;
  notaRemessa: string | null;
  notaRetorno: string | null;
  observacao: string | null;
};

// Campos opcionais que o formulário de transição pode enviar junto —
// `undefined` = "não mexer nesse campo", `null` explícito = "limpar", valor =
// grava. Mesmo contrato de DadosTransicaoCompra/DadosTransicaoEntrega.
export type DadosTransicaoTerceirizacao = {
  fornecedorId?: string | null;
  fornecedorNome?: string | null;
  previsaoRetorno?: Date | null;
  valorAcordado?: number | null;
  valorFinal?: number | null;
  notaRemessa?: string | null;
  notaRetorno?: string | null;
  observacao?: string | null;
};

export type AvancarSituacaoTerceirizacaoResult =
  | {
      ok: true;
      mensagem: string;
      situacaoAnterior: SituacaoTerceirizacao;
      proximaSituacao: SituacaoTerceirizacao;
    }
  | { ok: false; mensagem: string };

const MENSAGEM_CONFLITO =
  "Outra pessoa já alterou esta terceirização — recarregue a página e confira a situação atual.";

// PROBLEMA exige que o motivo seja registrado — mesma exigência de
// avancarStatusEntrega (src/app/producao/entrega-transicao.ts): uma
// transição sem o dado essencial dela é rejeitada antes de tocar o banco.
export async function avancarSituacaoTerceirizacao(
  etapa: EtapaTerceirizadaParaTransicao,
  proximaSituacao: SituacaoTerceirizacao,
  dados: DadosTransicaoTerceirizacao = {}
): Promise<AvancarSituacaoTerceirizacaoResult> {
  const situacaoAnterior = etapa.situacao;

  if (!TRANSICOES_VALIDAS[situacaoAnterior].includes(proximaSituacao)) {
    return {
      ok: false,
      mensagem: `Não é possível mudar de "${ROTULOS_SITUACAO_TERCEIRIZACAO[situacaoAnterior]}" para "${ROTULOS_SITUACAO_TERCEIRIZACAO[proximaSituacao]}".`,
    };
  }

  const observacaoFinal = dados.observacao !== undefined ? dados.observacao : etapa.observacao;
  if (proximaSituacao === "PROBLEMA" && !observacaoFinal?.trim()) {
    return { ok: false, mensagem: "Descreva o problema antes de marcar a terceirização como Problema." };
  }

  // Record<string, unknown> (não Prisma.EtapaTerceirizadaUpdateManyMutationInput
  // direto) — mesmo contorno de avancarStatusCompra
  // (src/app/compras/status-transicao.ts): o campo escalar de uma FK
  // opcional (fornecedorId) não aparece no tipo gerado pra updateMany.
  // Casteado só no ponto de uso, dentro da transação abaixo.
  const dadosUpdate: Record<string, unknown> = { situacao: proximaSituacao };
  if (dados.fornecedorId !== undefined) dadosUpdate.fornecedorId = dados.fornecedorId;
  if (dados.fornecedorNome !== undefined) dadosUpdate.fornecedorNome = dados.fornecedorNome;
  if (dados.previsaoRetorno !== undefined) dadosUpdate.previsaoRetorno = dados.previsaoRetorno;
  if (dados.valorAcordado !== undefined) dadosUpdate.valorAcordado = dados.valorAcordado;
  if (dados.valorFinal !== undefined) dadosUpdate.valorFinal = dados.valorFinal;
  if (dados.notaRemessa !== undefined) dadosUpdate.notaRemessa = dados.notaRemessa;
  if (dados.notaRetorno !== undefined) dadosUpdate.notaRetorno = dados.notaRetorno;
  if (dados.observacao !== undefined) dadosUpdate.observacao = dados.observacao;

  // enviadoEm/retornadoEm só são preenchidas na PRIMEIRA vez que a
  // terceirização entra nessa situação — nunca sobrescritas (ex: ENVIADO →
  // PROBLEMA → ENVIADO de novo não deveria resetar "quando de fato saiu").
  // Mesmo princípio de dataSaida/dataEntrega em entrega-transicao.ts.
  if (proximaSituacao === "ENVIADO" && etapa.enviadoEm === null) {
    dadosUpdate.enviadoEm = new Date();
  }
  if (proximaSituacao === "RETORNADO" && etapa.retornadoEm === null) {
    dadosUpdate.retornadoEm = new Date();
  }
  // Reentrar em ENVIADO é um NOVO ciclo de envio (a previsaoRetorno pode
  // estar sendo atualizada junto, ver dados.previsaoRetorno acima) — sem
  // resetar aqui, uma terceirização que já disparou o alerta de atraso uma
  // vez (ex: voltou de PROBLEMA e foi reenviada) nunca dispararia de novo se
  // atrasasse outra vez, diferente de Pedido.alertaAtrasoEnviadoEm (que nunca
  // reseta porque prazoEntrega de um pedido não recomeça um novo ciclo).
  if (proximaSituacao === "ENVIADO") {
    dadosUpdate.alertaAtrasoEnviadoEm = null;
  }

  // valorFinal preenchido (nesta transição ou em alguma anterior, já
  // persistido) gera o CustoPedido automático origem=TERCEIRIZACAO — achado
  // E1, efeito (b). Resolvido ANTES da transação pra decidir se há algo a
  // gerar; a criação em si roda dentro da MESMA transação do CAS, igual
  // avancarStatusCompra faz em RECEBIDO (src/app/compras/status-transicao.ts).
  const valorFinalFinal =
    dados.valorFinal !== undefined ? dados.valorFinal : etapa.valorFinal !== null ? Number(etapa.valorFinal) : null;

  try {
    await prisma.$transaction(async (tx) => {
      const resultado = await tx.etapaTerceirizada.updateMany({
        where: { id: etapa.id, situacao: situacaoAnterior },
        data: dadosUpdate as Prisma.EtapaTerceirizadaUpdateManyMutationInput,
      });
      if (resultado.count === 0) {
        throw new ErroTerceirizacaoJaAlterada();
      }

      if (valorFinalFinal !== null && valorFinalFinal > 0) {
        await criarCustoAutomaticoTerceirizacao(tx, {
          graficaId: etapa.graficaId,
          pedidoId: etapa.pedidoId,
          etapaTerceirizadaId: etapa.id,
          valor: valorFinalFinal,
        });
      }
    });
  } catch (erro) {
    if (erro instanceof ErroTerceirizacaoJaAlterada) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO };
    }
    throw erro;
  }

  revalidatePath("/producao");

  return {
    ok: true,
    mensagem: `Terceirização atualizada para "${ROTULOS_SITUACAO_TERCEIRIZACAO[proximaSituacao]}".`,
    situacaoAnterior,
    proximaSituacao,
  };
}

// Sinaliza, de dentro da transação, que a situação já mudou entre a leitura
// inicial e a escrita (duplo clique, duas abas) — mesmo papel de
// ErroPedidoJaAvancado em producao/status-transicao.ts.
class ErroTerceirizacaoJaAlterada extends Error {}
