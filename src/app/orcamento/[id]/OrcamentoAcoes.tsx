"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Input } from "@/components/ui/Input";
import { formatoMoeda } from "@/lib/moeda";
import { CheckCircleIcon } from "@/components/icons";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { atualizarStatusOrcamento, cancelarOrcamento, duplicarOrcamento } from "./actions";

type OpcaoParaAprovar = { id: string; nome: string; total: string };

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
  opcoes = [],
  totalOpcaoBase,
  prazoEntregaSugerido = null,
  creditoClienteDisponivel = null,
}: {
  orcamentoId: string;
  status: string;
  // Opções alternativas deste orçamento (ver model OrcamentoOpcao) — vazio
  // pra todo orçamento de opção única, o caso de sempre. Quando não vazio, o
  // vendedor precisa escolher qual delas está aprovando em nome do cliente
  // (mesma escolha que o link público oferece, ver src/app/o/[token]).
  opcoes?: OpcaoParaAprovar[];
  totalOpcaoBase: string;
  // Valor pré-calculado (hoje + prazoEntregaEstimadoDias, em dias úteis/
  // feriados da gráfica — ver somarDiasUteis em src/lib/dias-uteis.ts) só
  // pra PRÉ-PREENCHER o campo abaixo — puramente uma sugestão de
  // defaultValue, o vendedor continua livre pra digitar outra data.
  prazoEntregaSugerido?: string | null;
  // Achado A13 da auditoria de abrangência — saldo de CreditoCliente do
  // cliente deste orçamento (string, já formatado com 2 casas, ver
  // page.tsx). null quando o cliente não tem crédito nenhum — nesse caso o
  // campo "usar crédito" simplesmente não aparece, nunca força a escolha.
  creditoClienteDisponivel?: string | null;
}) {
  const [state, formAction, isPending] = useActionState(atualizarStatusOrcamento, null);
  const [opcaoEscolhidaId, setOpcaoEscolhidaId] = useState("");
  const [estadoCancelamento, acaoCancelar, cancelandoPending] = useActionState(
    cancelarOrcamento,
    null
  );
  // duplicarOrcamento redireciona pro novo orçamento em caso de sucesso (a
  // navegação acontece dentro da própria Server Action) — este estado só é
  // lido de fato quando a duplicação FALHA (o redirect nunca deixa o estado
  // de sucesso chegar a ser renderizado aqui).
  const [estadoDuplicacao, acaoDuplicar, duplicandoPending] = useActionState(duplicarOrcamento, null);
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
    return (
      <div className="flex flex-col gap-3">
        {status === "REJEITADO" ? (
          <p className="text-sm text-slate-500">
            Este orçamento está rejeitado e não muda mais de status.
          </p>
        ) : (
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
              <CheckCircleIcon className="h-4 w-4" />
            </span>
            <p className="text-sm text-slate-500">
              Este orçamento está aprovado e não muda mais de status.
            </p>
          </div>
        )}

        {estadoDuplicacao && !estadoDuplicacao.ok && (
          <Alert variant="error">{estadoDuplicacao.mensagem}</Alert>
        )}
        <form action={acaoDuplicar}>
          <input type="hidden" name="orcamentoId" value={orcamentoId} />
          <Button type="submit" variant="outline" loading={duplicandoPending}>
            Pedir de novo
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {state && !(state.ok && state.novoStatus === "APROVADO") && (
        <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>
      )}
      {state?.ok && state.aviso && <Alert variant="warning">{state.aviso}</Alert>}
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
        <div className="flex flex-col gap-3">
          {opcoes.length > 0 && !aprovacaoAcabouDeAcontecer && (
            <fieldset className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <legend className="px-1 text-xs font-medium text-slate-500">
                Qual opção o cliente escolheu?
              </legend>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="opcaoEscolhidaRadio"
                    checked={opcaoEscolhidaId === ""}
                    onChange={() => setOpcaoEscolhidaId("")}
                  />
                  Opção A
                </span>
                <span className="text-slate-500">{formatoMoeda.format(Number(totalOpcaoBase))}</span>
              </label>
              {opcoes.map((opcao) => (
                <label key={opcao.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="opcaoEscolhidaRadio"
                      checked={opcaoEscolhidaId === opcao.id}
                      onChange={() => setOpcaoEscolhidaId(opcao.id)}
                    />
                    {opcao.nome}
                  </span>
                  <span className="text-slate-500">{formatoMoeda.format(Number(opcao.total))}</span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <input type="hidden" name="orcamentoId" value={orcamentoId} />
              <input type="hidden" name="novoStatus" value="APROVADO" />
              <input type="hidden" name="opcaoId" value={opcaoEscolhidaId} />
              {!aprovacaoAcabouDeAcontecer && (
                <Input
                  label="Prazo de entrega (opcional)"
                  name="prazoEntrega"
                  type="date"
                  defaultValue={prazoEntregaSugerido ?? undefined}
                  hint="Se preenchido, um alerta de atraso pode ser disparado depois dessa data."
                />
              )}
              {!aprovacaoAcabouDeAcontecer && creditoClienteDisponivel && (
                <Input
                  label="Usar crédito do cliente (opcional)"
                  name="usarCredito"
                  type="number"
                  step="0.01"
                  min="0"
                  max={creditoClienteDisponivel}
                  placeholder="0,00"
                  hint={`Cliente tem ${formatoMoeda.format(Number(creditoClienteDisponivel))} de saldo adiantado. Deixe em branco pra não usar.`}
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
