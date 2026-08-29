"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { formatoMoeda } from "@/lib/moeda";
import { formatoData, dataEhPassado } from "@/lib/data";
import { registrarBaixaContaReceber, cancelarContaReceber } from "./actions";

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
  // Saldo em aberto — sempre calculado (achado A8 da Parte 4), nunca
  // armazenado. Igual a `valor` pra conta PENDENTE (nenhuma baixa ainda).
  saldo: string;
  vencimento: string; // ISO
  status: "PENDENTE" | "PARCIAL" | "RECEBIDO" | "CANCELADO";
  recebidoEm: string | null;
  orcamentoId: string;
  clienteNome: string;
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
  if (conta.status === "PARCIAL") {
    return (
      <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
        Parcial · falta {formatoMoeda.format(Number(conta.saldo))}
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

export function ContaReceberLinha({ conta, podeEditar }: { conta: ContaReceber; podeEditar: boolean }) {
  const [estadoRecebido, acaoRecebido, marcandoRecebido] = useActionState(registrarBaixaContaReceber, null);
  const [estadoCancelar, acaoCancelar, cancelando] = useActionState(cancelarContaReceber, null);
  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);

  useAoMudar(estadoCancelar, (estado) => {
    if (estado && !estado.ok) setConfirmandoCancelamento(false);
  });

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link
            href={`/orcamento/${conta.orcamentoId}`}
            className="font-medium text-slate-900 hover:underline dark:text-white"
          >
            {conta.descricao} — {conta.clienteNome}
          </Link>
          <p className="mt-0.5 text-xs text-slate-500">
            Vence em {formatoData.format(new Date(conta.vencimento))}
            {conta.status === "RECEBIDO" && conta.recebidoEm &&
              ` · Recebido em ${formatoData.format(new Date(conta.recebidoEm))}`}
          </p>
          {estadoRecebido && !estadoRecebido.ok && (
            <p className="mt-1 text-xs text-rose-600">{estadoRecebido.mensagem}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <p className="font-semibold text-slate-900 dark:text-white">
            {formatoMoeda.format(Number(conta.valor))}
          </p>
          {statusPill(conta)}
        </div>
      </div>

      {podeEditar &&
        (conta.status === "PENDENTE" || conta.status === "PARCIAL") &&
        !confirmandoCancelamento && (
          <div className="flex flex-wrap items-end gap-4 border-t border-slate-100 pt-3 dark:border-slate-800">
            <form action={acaoRecebido} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={conta.id} />
              {/* Valor editável (achado A8 da Parte 4) — pré-preenchido com o
                  saldo em aberto (valor cheio pra conta PENDENTE). Deixar como
                  está e enviar continua fechando a conta inteira, exatamente
                  como antes; reduzir o valor registra um recebimento parcial. */}
              <div className="flex flex-col gap-1">
                <label htmlFor={`valor-${conta.id}`} className="text-xs font-medium text-slate-500">
                  Valor recebido
                </label>
                <input
                  id={`valor-${conta.id}`}
                  type="number"
                  name="valor"
                  step="0.01"
                  min="0.01"
                  max={conta.saldo}
                  defaultValue={conta.saldo}
                  className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
              <Select label="Forma" name="forma" defaultValue="PIX" className="!py-1.5 text-xs">
                {Object.entries(ROTULO_FORMA).map(([valor, rotulo]) => (
                  <option key={valor} value={valor}>
                    {rotulo}
                  </option>
                ))}
              </Select>
              <Button type="submit" variant="outline" loading={marcandoRecebido}>
                {marcandoRecebido ? "Registrando..." : "Registrar recebimento"}
              </Button>
            </form>
            {conta.status === "PENDENTE" && (
              <button
                type="button"
                onClick={() => setConfirmandoCancelamento(true)}
                className="text-xs font-medium text-rose-600 hover:underline"
              >
                Cancelar
              </button>
            )}
          </div>
        )}

      {confirmandoCancelamento && (
        <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
          <ConfirmarExclusao
            pergunta={`Cancelar a conta a receber "${conta.descricao}" (${formatoMoeda.format(Number(conta.valor))})?`}
            onCancelar={() => setConfirmandoCancelamento(false)}
            formAction={acaoCancelar}
            campos={{ id: conta.id }}
            rotuloBotao="Cancelar conta"
            pendente={cancelando}
          />
        </div>
      )}
      {estadoCancelar && !estadoCancelar.ok && !confirmandoCancelamento && (
        <p className="text-xs text-rose-600">{estadoCancelar.mensagem}</p>
      )}
    </Card>
  );
}
