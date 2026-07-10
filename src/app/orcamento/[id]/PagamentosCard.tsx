"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { registrarPagamento, excluirPagamento } from "./actions";

const ROTULO_FORMA: Record<string, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CARTAO: "Cartão",
  BOLETO: "Boleto",
  TRANSFERENCIA: "Transferência",
  OUTRO: "Outro",
};

type Pagamento = {
  id: string;
  valor: string;
  forma: string;
  observacao: string | null;
  createdAt: string;
};

const formatoMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function LinhaPagamento({ pagamento }: { pagamento: Pagamento }) {
  const [state, formAction, isPending] = useActionState(excluirPagamento, null);

  return (
    <div className="flex items-center justify-between gap-3 p-4">
      <div>
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
          {formatoMoeda.format(Number(pagamento.valor))}
          <span className="ml-2 text-xs font-normal text-slate-500">
            {ROTULO_FORMA[pagamento.forma] ?? pagamento.forma}
          </span>
        </p>
        <p className="text-xs text-slate-500">
          {new Date(pagamento.createdAt).toLocaleDateString("pt-BR")}
          {pagamento.observacao && ` · ${pagamento.observacao}`}
        </p>
        {state && !state.ok && (
          <p className="mt-1 text-xs text-rose-600">{state.mensagem}</p>
        )}
      </div>
      <form action={formAction}>
        <input type="hidden" name="pagamentoId" value={pagamento.id} />
        <button
          type="submit"
          disabled={isPending}
          className="text-xs font-medium text-rose-600 hover:underline disabled:opacity-50"
        >
          Remover
        </button>
      </form>
    </div>
  );
}

export function PagamentosCard({
  orcamentoId,
  total,
  pagamentos,
  podeRegistrar,
}: {
  orcamentoId: string;
  total: number;
  pagamentos: Pagamento[];
  podeRegistrar: boolean;
}) {
  const [state, formAction, isPending] = useActionState(registrarPagamento, null);

  const valorPago = pagamentos.reduce((soma, p) => soma + Number(p.valor), 0);
  const saldoDevedor = total - valorPago;

  const badge =
    valorPago === 0
      ? { texto: "Sem pagamento", classe: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" }
      : saldoDevedor > 0
        ? { texto: "Parcial", classe: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" }
        : { texto: "Pago", classe: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" };

  return (
    <Card className="mb-6 flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">Pagamentos</p>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.classe}`}>
          {badge.texto}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-slate-500">Pago</p>
          <p className="font-semibold text-slate-900 dark:text-white">
            {formatoMoeda.format(valorPago)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Saldo devedor</p>
          <p
            className={`font-semibold ${
              saldoDevedor > 0
                ? "text-rose-600 dark:text-rose-400"
                : "text-slate-900 dark:text-white"
            }`}
          >
            {formatoMoeda.format(saldoDevedor)}
          </p>
        </div>
      </div>

      {pagamentos.length > 0 && (
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {pagamentos.map((p) => (
            <LinhaPagamento key={p.id} pagamento={p} />
          ))}
        </div>
      )}

      {podeRegistrar ? (
        <form action={formAction} className="flex flex-col gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <input type="hidden" name="orcamentoId" value={orcamentoId} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input label="Valor" name="valor" type="number" step="0.01" min="0.01" required />
            <Select label="Forma" name="forma" defaultValue="PIX">
              {Object.entries(ROTULO_FORMA).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </Select>
            <Input label="Observação (opcional)" name="observacao" />
          </div>
          {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
          <Button type="submit" loading={isPending} className="self-start">
            {isPending ? "Registrando..." : "Registrar pagamento"}
          </Button>
        </form>
      ) : (
        <p className="border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-slate-800">
          Pagamentos só podem ser registrados com o orçamento aprovado.
        </p>
      )}
    </Card>
  );
}
