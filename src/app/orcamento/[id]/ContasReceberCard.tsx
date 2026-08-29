"use client";

import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { formatoMoeda } from "@/lib/moeda";
import { formatoData, dataEhPassado } from "@/lib/data";
import {
  criarContaReceber,
  marcarComoRecebido,
  cancelarContaReceber,
} from "@/app/financeiro/contas-receber/actions";

const ROTULO_FORMA: Record<string, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CARTAO: "Cartão",
  BOLETO: "Boleto",
  TRANSFERENCIA: "Transferência",
  OUTRO: "Outro",
};

type ContaReceber = {
  id: string;
  descricao: string;
  valor: string;
  vencimento: string; // ISO
  status: "PENDENTE" | "RECEBIDO" | "CANCELADO";
  recebidoEm: string | null;
};

function statusPill(conta: ContaReceber) {
  if (conta.status === "RECEBIDO") {
    return (
      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
        Recebido
      </span>
    );
  }
  if (conta.status === "CANCELADO") {
    return (
      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        Cancelado
      </span>
    );
  }
  if (dataEhPassado(new Date(conta.vencimento))) {
    return (
      <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
        Vencido
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
      Pendente
    </span>
  );
}

function LinhaContaReceber({ conta, podeEditar }: { conta: ContaReceber; podeEditar: boolean }) {
  const [estadoRecebido, acaoRecebido, marcandoRecebido] = useActionState(marcarComoRecebido, null);
  const [estadoCancelar, acaoCancelar, cancelando] = useActionState(cancelarContaReceber, null);
  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);

  useAoMudar(estadoCancelar, (estado) => {
    if (estado && !estado.ok) setConfirmandoCancelamento(false);
  });

  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
            {conta.descricao}
            <span className="ml-2 text-xs font-normal text-slate-500">
              {formatoMoeda.format(Number(conta.valor))}
            </span>
          </p>
          <p className="text-xs text-slate-500">
            Vence em {formatoData.format(new Date(conta.vencimento))}
            {conta.status === "RECEBIDO" && conta.recebidoEm &&
              ` · Recebido em ${formatoData.format(new Date(conta.recebidoEm))}`}
          </p>
          {estadoRecebido && !estadoRecebido.ok && (
            <p className="mt-1 text-xs text-rose-600">{estadoRecebido.mensagem}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {statusPill(conta)}
        </div>
      </div>

      {podeEditar && conta.status === "PENDENTE" && !confirmandoCancelamento && (
        <div className="flex flex-wrap items-end gap-3">
          <form action={acaoRecebido} className="flex items-end gap-2">
            <input type="hidden" name="id" value={conta.id} />
            <Select label="Forma" name="forma" defaultValue="PIX" className="!py-1.5 text-xs">
              {Object.entries(ROTULO_FORMA).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="outline" loading={marcandoRecebido}>
              {marcandoRecebido ? "Marcando..." : "Marcar como recebido"}
            </Button>
          </form>
          <button
            type="button"
            onClick={() => setConfirmandoCancelamento(true)}
            className="text-xs font-medium text-rose-600 hover:underline"
          >
            Cancelar
          </button>
        </div>
      )}

      {confirmandoCancelamento && (
        <ConfirmarExclusao
          pergunta={`Cancelar a conta a receber "${conta.descricao}" (${formatoMoeda.format(Number(conta.valor))})?`}
          onCancelar={() => setConfirmandoCancelamento(false)}
          formAction={acaoCancelar}
          campos={{ id: conta.id }}
          rotuloBotao="Cancelar conta"
          pendente={cancelando}
        />
      )}
      {estadoCancelar && !estadoCancelar.ok && !confirmandoCancelamento && (
        <p className="text-xs text-rose-600">{estadoCancelar.mensagem}</p>
      )}
    </div>
  );
}

export function ContasReceberCard({
  orcamentoId,
  contas,
  podeEditar,
  vencimentoSugerido = null,
}: {
  orcamentoId: string;
  contas: ContaReceber[];
  podeEditar: boolean;
  // Achado A6 da Parte 5 da auditoria de abrangência — "AAAA-MM-DD" sugerido
  // a partir de Cliente.prazoPagamentoPadraoDias (hoje + N dias), ou null se
  // o cliente não tem prazo cadastrado (campo nasce em branco, comportamento
  // de hoje). Só um defaultValue — o campo continua editável e obrigatório
  // como sempre.
  vencimentoSugerido?: string | null;
}) {
  const [state, formAction, isPending] = useActionState(criarContaReceber, null);

  const totalPendente = contas
    .filter((c) => c.status === "PENDENTE")
    .reduce((soma, c) => soma + Number(c.valor), 0);
  const totalRecebido = contas
    .filter((c) => c.status === "RECEBIDO")
    .reduce((soma, c) => soma + Number(c.valor), 0);

  const badge =
    contas.length === 0
      ? { texto: "Sem parcelas", classe: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" }
      : totalPendente > 0
        ? { texto: "Pendente", classe: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" }
        : { texto: "Tudo recebido", classe: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" };

  return (
    <Card className="mb-6 flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">Contas a receber</p>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.classe}`}>
          {badge.texto}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-slate-500">Pendente</p>
          <p
            className={`font-semibold ${
              totalPendente > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-900 dark:text-white"
            }`}
          >
            {formatoMoeda.format(totalPendente)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Recebido</p>
          <p className="font-semibold text-slate-900 dark:text-white">
            {formatoMoeda.format(totalRecebido)}
          </p>
        </div>
      </div>

      {contas.length > 0 && (
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {contas.map((c) => (
            <LinhaContaReceber key={c.id} conta={c} podeEditar={podeEditar} />
          ))}
        </div>
      )}

      {podeEditar ? (
        <form action={formAction} className="flex flex-col gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <input type="hidden" name="orcamentoId" value={orcamentoId} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input label="Descrição" name="descricao" placeholder="Ex: Parcela 1/3" required />
            <Input label="Valor" name="valor" type="number" step="0.01" min="0.01" required />
            <Input
              label="Vencimento"
              name="vencimento"
              type="date"
              required
              defaultValue={vencimentoSugerido ?? undefined}
            />
          </div>
          {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
          <Button type="submit" loading={isPending} className="self-start">
            {isPending ? "Cadastrando..." : "Adicionar parcela"}
          </Button>
        </form>
      ) : (
        <p className="border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-slate-800">
          Você não tem permissão pra editar o Financeiro.
        </p>
      )}
    </Card>
  );
}
