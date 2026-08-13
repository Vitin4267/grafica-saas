"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { PrinterIcon } from "@/components/icons";
import { AvancarPedidoButton } from "./AvancarPedidoButton";
import {
  useIniciarImpressao,
  IniciarImpressaoBotao,
  PainelConfirmacaoImpressao,
} from "./IniciarImpressaoConfirm";
import { EnviarArteForm } from "./EnviarArteForm";
import { cancelarPedido, avancarPedido } from "./actions";

// Linha inteira é um client component (não só o botão de cancelar) pra poder
// colocar o ConfirmarExclusao como bloco abaixo da linha inteira quando
// confirmando — mesmo padrão de PagamentosCard.tsx, em vez de espremer a
// confirmação dentro do grupinho de botões à direita.
export function PedidoLinha({
  pedidoId,
  orcamentoId,
  clienteNome,
  itensResumo,
  status,
  podeEditar,
  chipAtraso,
  arteUrl,
  arteAprovadaEm,
  arteComentarioCliente,
  linkArtePublico,
}: {
  pedidoId: string;
  orcamentoId: string;
  clienteNome: string;
  itensResumo: string;
  status: string;
  podeEditar: boolean;
  chipAtraso: ReactNode;
  arteUrl: string | null;
  arteAprovadaEm: Date | null;
  arteComentarioCliente: string | null;
  linkArtePublico: string | null;
}) {
  const [state, formAction, isPending] = useActionState(cancelarPedido, null);
  const [confirmando, setConfirmando] = useState(false);
  const podeCancelar = status !== "ENTREGUE" && status !== "CANCELADO";

  // FILA é a única transição que baixa estoque (ver avancarPedido) — por
  // isso é a única que passa por uma tela de confirmação editável em vez do
  // botão de um clique só que AvancarPedidoButton usa pros outros status.
  const iniciarImpressao = useIniciarImpressao(pedidoId);
  const [avancarState, avancarFormAction, avancarPending] = useActionState(avancarPedido, null);
  useAoMudar(avancarState, (estado) => {
    if (estado?.ok) iniciarImpressao.cancelar();
  });

  // Ao contrário de PagamentosCard (onde sucesso remove a linha da lista e o
  // componente desmonta sozinho), aqui o pedido continua na lista com um
  // status novo — sem isso, a caixa de confirmação ficava presa aberta pra
  // sempre depois de cancelar com sucesso (bug encontrado testando na mão).
  useAoMudar(state, (state) => {
    if (state) setConfirmando(false);
  });

  return (
    <div className="flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
            <PrinterIcon className="h-5 w-5" />
          </span>
          <div>
            <p className="font-medium text-slate-900 dark:text-white">{clienteNome}</p>
            <p className="text-sm text-slate-500">{itensResumo}</p>
            <Link
              href={`/orcamento/${orcamentoId}`}
              className="text-xs text-teal-700 hover:underline dark:text-teal-400"
            >
              Ver orçamento
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {chipAtraso}
          <StatusBadge status={status} tipo="pedido" />
          {podeEditar && (
            <>
              {status === "FILA" ? (
                <IniciarImpressaoBotao estado={iniciarImpressao.estado} onIniciar={iniciarImpressao.iniciar} />
              ) : (
                <AvancarPedidoButton pedidoId={pedidoId} status={status} />
              )}
              {podeCancelar && (
                <Button
                  type="button"
                  variant="ghost"
                  className="!text-rose-600 hover:!bg-rose-50 dark:!text-rose-400 dark:hover:!bg-rose-950/50"
                  onClick={() => setConfirmando(true)}
                >
                  Cancelar
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {podeEditar && status === "FILA" && (
        <EnviarArteForm
          pedidoId={pedidoId}
          arteUrl={arteUrl}
          arteAprovadaEm={arteAprovadaEm}
          arteComentarioCliente={arteComentarioCliente}
          linkArtePublico={linkArtePublico}
        />
      )}

      {iniciarImpressao.estado.tipo === "confirmando" && (
        <PainelConfirmacaoImpressao
          pedidoId={pedidoId}
          itens={iniciarImpressao.estado.itens}
          formAction={avancarFormAction}
          isPending={avancarPending}
          erroSubmit={avancarState && !avancarState.ok ? avancarState.mensagem : undefined}
          onCancelar={iniciarImpressao.cancelar}
        />
      )}

      {confirmando && (
        <ConfirmarExclusao
          pergunta={
            status === "FILA"
              ? "Cancelar este pedido? Nenhuma matéria-prima foi baixada ainda."
              : "Cancelar este pedido? A matéria-prima já baixada pra produção volta pro estoque automaticamente."
          }
          onCancelar={() => setConfirmando(false)}
          formAction={formAction}
          campos={{ pedidoId }}
          rotuloBotao="Cancelar pedido"
          pendente={isPending}
        />
      )}
      {state && !state.ok && <p className="text-xs text-rose-600">{state.mensagem}</p>}
    </div>
  );
}
