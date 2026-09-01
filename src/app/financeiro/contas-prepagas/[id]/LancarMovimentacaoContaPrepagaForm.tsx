"use client";

import { useActionState } from "react";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { CampoAjuda } from "@/components/ui/CampoAjuda";
import { lancarMovimentacaoContaPrepaga } from "../actions";

const ROTULO_FORMA: Record<string, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CARTAO: "Cartão",
  BOLETO: "Boleto",
  TRANSFERENCIA: "Transferência",
  OUTRO: "Outro",
};

// Um único form com o tipo escolhido no Select (RECARGA/DEBITO) — mais
// simples que abas separadas (LancarMovimentacaoForm.tsx, em catalogo) já
// que os dois tipos aqui compartilham exatamente os mesmos campos
// (valor + motivo opcional), diferente da movimentação de estoque.
export function LancarMovimentacaoContaPrepagaForm({ contaId }: { contaId: string }) {
  const [state, formAction, isPending] = useActionState(lancarMovimentacaoContaPrepaga, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="contaId" value={contaId} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Select
          label={
            <>
              Tipo
              <CampoAjuda texto="Recarga é quando você deposita dinheiro nessa carteira no fornecedor — gera uma despesa automática, porque saiu dinheiro de verdade do caixa. Débito é quando você usa o saldo já depositado (ex: uma corrida do Lalamove) — só abate o saldo, sem criar despesa nova." />
            </>
          }
          name="tipo"
          defaultValue="RECARGA"
        >
          <option value="RECARGA">Recarga</option>
          <option value="DEBITO">Débito</option>
        </Select>
        <Input label="Valor (R$)" name="valor" type="number" step="0.01" min="0.01" required />
        {/* Só se aplica a RECARGA (vira Despesa espelhada) — presente sempre
            no form pra não precisar de estado controlado só pra
            mostrar/esconder um campo; ignorado no servidor pra DEBITO. */}
        <Select label="Forma (se recarga)" name="formaPagamento" defaultValue="PIX">
          {Object.entries(ROTULO_FORMA).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </Select>
        <Input label="Motivo (opcional)" name="motivo" placeholder="ex: corrida até o cliente X" />
      </div>
      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Lançando..." : "Lançar movimentação"}
      </Button>
    </form>
  );
}
