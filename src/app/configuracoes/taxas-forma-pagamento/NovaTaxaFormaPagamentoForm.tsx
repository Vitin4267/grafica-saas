"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ROTULO_FORMA_PAGAMENTO, FORMAS_PAGAMENTO_VALIDAS } from "./tipos";
import { criarTaxaFormaPagamento } from "./actions";

export function NovaTaxaFormaPagamentoForm({
  formasJaCadastradas,
}: {
  // Já tem no máximo 1 taxa por forma (constraint no banco) — tira do
  // <select> de "nova" as formas que já têm cadastro, pra não colidir e ter
  // que descobrir a mensagem de erro. Editar uma existente é ir na tela dela.
  formasJaCadastradas: string[];
}) {
  const [state, formAction, isPending] = useActionState(criarTaxaFormaPagamento, null);
  const formasDisponiveis = FORMAS_PAGAMENTO_VALIDAS.filter(
    (forma) => !formasJaCadastradas.includes(forma)
  );

  if (formasDisponiveis.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Todas as formas de pagamento já têm uma taxa cadastrada.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Select label="Forma de pagamento" name="forma" defaultValue={formasDisponiveis[0]}>
          {formasDisponiveis.map((forma) => (
            <option key={forma} value={forma}>
              {ROTULO_FORMA_PAGAMENTO[forma] ?? forma}
            </option>
          ))}
        </Select>
        <Input
          label="Taxa (%)"
          name="percentual"
          type="number"
          step="0.01"
          min="0"
          placeholder="3,50"
          hint="Ex: 3,5 pra 3,5% de MDR."
        />
        <Input
          label="Dias até compensar"
          name="diasCompensacao"
          type="number"
          step="1"
          min="0"
          placeholder="0"
          hint="Ex: 0 pro Pix, 30 pro cartão de crédito."
        />
      </div>
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Criando..." : "+ Nova taxa"}
      </Button>
    </form>
  );
}
