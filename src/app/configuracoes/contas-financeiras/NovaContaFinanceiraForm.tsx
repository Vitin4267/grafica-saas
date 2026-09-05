"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ROTULO_TIPO_CONTA_FINANCEIRA } from "./tipos";
import { criarContaFinanceira } from "./actions";

export function NovaContaFinanceiraForm() {
  const [state, formAction, isPending] = useActionState(criarContaFinanceira, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Nome"
          name="nome"
          type="text"
          placeholder="ex: Banco do Brasil - Conta principal"
          required
        />
        <Select label="Tipo" name="tipo" defaultValue="CONTA_CORRENTE">
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
          placeholder="0,00"
          hint="Só uma referência — o sistema não soma pagamentos/despesas pra apurar saldo atual."
        />
        <Input label="Saldo inicial em (opcional)" name="saldoInicialEm" type="date" />
      </div>
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Criando..." : "+ Nova conta"}
      </Button>
    </form>
  );
}
