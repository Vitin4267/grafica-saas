"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { formatoMoeda } from "@/lib/moeda";
import { marcarComissaoPaga } from "./actions";

const ROTULO_FORMA: Record<string, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CARTAO: "Cartão",
  BOLETO: "Boleto",
  TRANSFERENCIA: "Transferência",
  OUTRO: "Outro",
};

const ROTULO_BASE: Record<string, string> = {
  VALOR: "sobre valor",
  LUCRO: "sobre lucro",
};

export function ComissaoLinha({
  comissaoId,
  vendedorNome,
  orcamentoId,
  baseCalculo,
  percentualAplicado,
  valorComissao,
  status,
  pagoEm,
  podeEditar,
}: {
  comissaoId: string;
  vendedorNome: string;
  orcamentoId: string;
  baseCalculo: string;
  percentualAplicado: string;
  valorComissao: string;
  status: "PENDENTE" | "PAGA" | "CANCELADA";
  pagoEm: string | null;
  podeEditar: boolean;
}) {
  const [estado, formAction, isPending] = useActionState(marcarComissaoPaga, null);

  return (
    <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium text-slate-900 dark:text-white">{vendedorNome}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Orçamento {orcamentoId.slice(0, 8)} · {(Number(percentualAplicado) * 100).toFixed(2)}%{" "}
          {ROTULO_BASE[baseCalculo] ?? baseCalculo}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="font-semibold text-slate-900 dark:text-white">
            {formatoMoeda.format(Number(valorComissao))}
          </p>
          {status === "PAGA" ? (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
              Paga em {pagoEm}
            </span>
          ) : status === "CANCELADA" ? (
            // Comissão de um orçamento cujo pedido foi cancelado (achado N2
            // da auditoria de abrangência) — nunca vai gerar pagamento.
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              Cancelada
            </span>
          ) : (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
              Pendente
            </span>
          )}
        </div>
        {podeEditar && status === "PENDENTE" && (
          <form action={formAction} className="flex items-center gap-2">
            <input type="hidden" name="comissaoId" value={comissaoId} />
            <Select label="Forma" name="formaPagamento" defaultValue="PIX" className="!py-1.5 text-xs">
              {Object.entries(ROTULO_FORMA).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="outline" loading={isPending} className="!px-3 !py-1.5 text-xs">
              Marcar paga
            </Button>
          </form>
        )}
      </div>
      {estado && !estado.ok && <p className="text-xs text-rose-600">{estado.mensagem}</p>}
    </Card>
  );
}
