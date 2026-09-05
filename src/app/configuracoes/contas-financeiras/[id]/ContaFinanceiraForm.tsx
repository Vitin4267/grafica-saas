"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ROTULO_TIPO_CONTA_FINANCEIRA } from "../tipos";
import { editarContaFinanceira, alternarAtivaContaFinanceira } from "../actions";

export function ContaFinanceiraForm({
  contaId,
  nome,
  tipo,
  saldoInicial,
  saldoInicialEm,
  ativa,
}: {
  contaId: string;
  nome: string;
  tipo: string;
  saldoInicial: string;
  saldoInicialEm: string;
  ativa: boolean;
}) {
  const [state, formAction, isPending] = useActionState(editarContaFinanceira, null);
  const [estadoAtiva, alternarAction, alternandoPending] = useActionState(
    alternarAtivaContaFinanceira,
    null
  );

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="contaId" value={contaId} />
        <Card className="flex flex-col gap-4 p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Nome" name="nome" type="text" defaultValue={nome} required />
            <Select label="Tipo" name="tipo" defaultValue={tipo}>
              {Object.entries(ROTULO_TIPO_CONTA_FINANCEIRA).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </Select>
            <Input
              label="Saldo inicial (opcional)"
              name="saldoInicial"
              type="number"
              step="0.01"
              defaultValue={saldoInicial}
              hint="Só uma referência — o sistema não soma pagamentos/despesas pra apurar saldo atual."
            />
            <Input
              label="Saldo inicial em (opcional)"
              name="saldoInicialEm"
              type="date"
              defaultValue={saldoInicialEm}
            />
          </div>
        </Card>
        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}
        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar conta"}
        </Button>
      </form>

      <Card className="flex items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-white">
            {ativa ? "Conta ativa" : "Conta inativa"}
          </p>
          <p className="text-xs text-slate-500">
            {ativa
              ? "Aparece pra seleção ao registrar um pagamento recebido ou marcar uma despesa como paga."
              : "Some da seleção pra vínculo novo, mas pagamentos/despesas já vinculados a ela continuam no histórico. Nunca é excluída de verdade."}
          </p>
          {estadoAtiva && !estadoAtiva.ok && (
            <p className="mt-1 text-xs text-rose-600">{estadoAtiva.mensagem}</p>
          )}
        </div>
        <form action={alternarAction}>
          <input type="hidden" name="contaId" value={contaId} />
          <Button type="submit" variant="outline" loading={alternandoPending} className="shrink-0">
            {ativa ? "Desativar" : "Ativar"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
