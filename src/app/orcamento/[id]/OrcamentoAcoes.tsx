"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Input } from "@/components/ui/Input";
import { CheckCircleIcon } from "@/components/icons";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { atualizarStatusOrcamento, cancelarOrcamento } from "./actions";

// Ícone de "aprovado" com um pop de escala rápido e sutil ao aparecer — puro
// CSS (transition de transform/opacity disparada no frame seguinte ao mount),
// sem @keyframes global. Respeita prefers-reduced-motion via motion-reduce:
// (Tailwind já aplica isso pela media query, sem depender de JS): o elemento
// nasce direto no estado final, sem transição.
function CheckAprovadoAnimado() {
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    const quadro = requestAnimationFrame(() => setVisivel(true));
    return () => cancelAnimationFrame(quadro);
  }, []);

  return (
    <span
      role="img"
      aria-label="Aprovado"
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 transition-all duration-300 ease-out motion-reduce:transition-none motion-reduce:scale-100 motion-reduce:opacity-100 dark:bg-emerald-950 dark:text-emerald-400 ${
        visivel ? "scale-100 opacity-100" : "scale-50 opacity-0"
      }`}
    >
      <CheckCircleIcon className="h-5 w-5" />
    </span>
  );
}

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

  // Marca que a transição pra APROVADO acabou de ser confirmada pelo
  // servidor nesta sessão do componente — troca o botão "Aprovar" por um
  // check verde animado. Fica true mesmo depois que `status` virar
  // "APROVADO" via revalidação (o componente não desmonta), então o branch
  // terminal abaixo também sabe que foi "recém aprovado" nesta visita.
  const [aprovacaoAcabouDeAcontecer, setAprovacaoAcabouDeAcontecer] = useState(false);

  useAoMudar(state, (state) => {
    if (state?.ok && state.novoStatus === "APROVADO") {
      setAprovacaoAcabouDeAcontecer(true);
    }
  });

  if (status === "APROVADO" || status === "REJEITADO") {
    if (status === "REJEITADO") {
      return (
        <p className="text-sm text-slate-500">
          Este orçamento está rejeitado e não muda mais de status.
        </p>
      );
    }
    return (
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
          <CheckCircleIcon className="h-4 w-4" />
        </span>
        <p className="text-sm text-slate-500">
          Este orçamento está aprovado e não muda mais de status.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {state && !(state.ok && state.novoStatus === "APROVADO") && (
        <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>
      )}
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="orcamentoId" value={orcamentoId} />
            <input type="hidden" name="novoStatus" value="APROVADO" />
            {!aprovacaoAcabouDeAcontecer && (
              <Input
                label="Prazo de entrega (opcional)"
                name="prazoEntrega"
                type="date"
                hint="Se preenchido, um alerta de atraso pode ser disparado depois dessa data."
              />
            )}
            {aprovacaoAcabouDeAcontecer ? (
              <CheckAprovadoAnimado />
            ) : (
              <Button type="submit" loading={isPending}>
                Aprovar
              </Button>
            )}
          </form>
          {!aprovacaoAcabouDeAcontecer && (
            <Button type="button" variant="outline" onClick={() => setConfirmandoRejeicao(true)}>
              Rejeitar
            </Button>
          )}
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
