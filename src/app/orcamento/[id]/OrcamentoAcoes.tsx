"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { atualizarStatusOrcamento, cancelarOrcamento } from "./actions";

export function OrcamentoAcoes({
  orcamentoId,
  status,
}: {
  orcamentoId: string;
  status: string;
}) {
  const [state, formAction, isPending] = useActionState(atualizarStatusOrcamento, null);
  const [estadoCancelamento, acaoCancelar, cancelandoPending] = useActionState(
    cancelarOrcamento,
    null
  );
  const [confirmandoRejeicao, setConfirmandoRejeicao] = useState(false);
  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);

  if (status === "APROVADO" || status === "REJEITADO") {
    return (
      <p className="text-sm text-slate-500">
        Este orçamento está {status === "APROVADO" ? "aprovado" : "rejeitado"} e não
        muda mais de status.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}
      {estadoCancelamento && !estadoCancelamento.ok && (
        <Alert variant="error">{estadoCancelamento.mensagem}</Alert>
      )}

      {status === "RASCUNHO" && !confirmandoCancelamento && (
        <div className="flex gap-3">
          <form action={formAction}>
            <input type="hidden" name="orcamentoId" value={orcamentoId} />
            <input type="hidden" name="novoStatus" value="ENVIADO" />
            <Button type="submit" loading={isPending}>
              Marcar como enviado
            </Button>
          </form>
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmandoCancelamento(true)}
          >
            Cancelar orçamento
          </Button>
        </div>
      )}

      {status === "RASCUNHO" && confirmandoCancelamento && (
        <div className="flex flex-col gap-3">
          <Alert variant="error">
            Tem certeza que quer cancelar este orçamento? Ele será excluído e não
            pode ser recuperado.
          </Alert>
          <div className="flex gap-3">
            <form action={acaoCancelar}>
              <input type="hidden" name="orcamentoId" value={orcamentoId} />
              <Button type="submit" variant="secondary" loading={cancelandoPending}>
                Confirmar cancelamento
              </Button>
            </form>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmandoCancelamento(false)}
            >
              Voltar
            </Button>
          </div>
        </div>
      )}

      {status === "ENVIADO" && !confirmandoRejeicao && (
        <div className="flex gap-3">
          <form action={formAction}>
            <input type="hidden" name="orcamentoId" value={orcamentoId} />
            <input type="hidden" name="novoStatus" value="APROVADO" />
            <Button type="submit" loading={isPending}>
              Aprovar
            </Button>
          </form>
          <Button type="button" variant="outline" onClick={() => setConfirmandoRejeicao(true)}>
            Rejeitar
          </Button>
        </div>
      )}

      {status === "ENVIADO" && confirmandoRejeicao && (
        <div className="flex flex-col gap-3">
          <Alert variant="error">
            Tem certeza que quer rejeitar este orçamento? Esta ação não pode ser
            desfeita.
          </Alert>
          <div className="flex gap-3">
            <form action={formAction}>
              <input type="hidden" name="orcamentoId" value={orcamentoId} />
              <input type="hidden" name="novoStatus" value="REJEITADO" />
              <Button type="submit" variant="secondary" loading={isPending}>
                Confirmar rejeição
              </Button>
            </form>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmandoRejeicao(false)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
