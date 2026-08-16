"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { useIniciarImpressao, PainelConfirmacaoImpressao } from "./IniciarImpressaoConfirm";
import { avancarPedido } from "./actions";

// Solta um card de "Fila" em "Impressão" no Kanban precisa abrir EXATAMENTE
// o mesmo fluxo que IniciarImpressaoBotao usa na visão de lista (ver
// PedidoLinha.tsx) — FILA→IMPRESSAO baixa estoque automaticamente e pode
// envolver ajuste de perda de material, nunca é um "solta e pronto" como as
// outras transições. Reaproveita o hook e o painel de confirmação já
// existentes (useIniciarImpressao / PainelConfirmacaoImpressao), só troca o
// empacotamento visual — painel inline na linha vira modal aqui.
export function ModalConfirmarImpressao({
  pedidoId,
  onFechar,
}: {
  pedidoId: string;
  onFechar: () => void;
}) {
  const iniciarImpressao = useIniciarImpressao(pedidoId);
  const [avancarState, avancarFormAction, avancarPending] = useActionState(avancarPedido, null);

  // Dispara a previsão de baixa assim que o modal monta (equivalente a
  // clicar no botão "Iniciar impressão" da lista) — guard por ref, não por
  // array de dependências vazio, porque `iniciarImpressao.iniciar` é uma
  // função nova a cada render do hook.
  const jaIniciou = useRef(false);
  useEffect(() => {
    if (jaIniciou.current) return;
    jaIniciou.current = true;
    iniciarImpressao.iniciar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useAoMudar(avancarState, (estado) => {
    if (estado?.ok) onFechar();
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar início de impressão"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl dark:bg-slate-900">
        {iniciarImpressao.estado.tipo === "idle" || iniciarImpressao.estado.tipo === "carregando" ? (
          <div className="flex items-center justify-center p-8">
            <p className="text-sm text-slate-500">Carregando previsão de baixa de estoque…</p>
          </div>
        ) : iniciarImpressao.estado.tipo === "erro" ? (
          <div className="flex flex-col gap-3 p-6">
            <p className="text-sm text-rose-600">{iniciarImpressao.estado.mensagem}</p>
            <Button type="button" variant="ghost" onClick={onFechar}>
              Fechar
            </Button>
          </div>
        ) : (
          <div className="p-4">
            <PainelConfirmacaoImpressao
              pedidoId={pedidoId}
              itens={iniciarImpressao.estado.itens}
              formAction={avancarFormAction}
              isPending={avancarPending}
              erroSubmit={avancarState && !avancarState.ok ? avancarState.mensagem : undefined}
              onCancelar={onFechar}
            />
          </div>
        )}
      </div>
    </div>
  );
}
