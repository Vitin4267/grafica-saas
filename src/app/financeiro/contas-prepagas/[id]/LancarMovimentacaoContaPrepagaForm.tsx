"use client";

import { useActionState } from "react";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { lancarMovimentacaoContaPrepaga } from "../actions";

// Um único form com o tipo escolhido no Select (RECARGA/DEBITO) — mais
// simples que abas separadas (LancarMovimentacaoForm.tsx, em catalogo) já
// que os dois tipos aqui compartilham exatamente os mesmos campos
// (valor + motivo opcional), diferente da movimentação de estoque.
export function LancarMovimentacaoContaPrepagaForm({ contaId }: { contaId: string }) {
  const [state, formAction, isPending] = useActionState(lancarMovimentacaoContaPrepaga, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="contaId" value={contaId} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Select label="Tipo" name="tipo" defaultValue="RECARGA">
          <option value="RECARGA">Recarga</option>
          <option value="DEBITO">Débito</option>
        </Select>
        <Input label="Valor (R$)" name="valor" type="number" step="0.01" min="0.01" required />
        <Input label="Motivo (opcional)" name="motivo" placeholder="ex: corrida até o cliente X" />
      </div>
      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Lançando..." : "Lançar movimentação"}
      </Button>
    </form>
  );
}
