"use client";

import { useActionState, useState } from "react";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { CampoAjuda } from "@/components/ui/CampoAjuda";
import { lancarMovimentacaoCreditoCliente } from "../actions";

// CONSUMO não aparece aqui de propósito — só nasce automaticamente quando um
// orçamento é aprovado usando o crédito do cliente (ver OrcamentoAcoes.tsx).
export function LancarMovimentacaoCreditoClienteForm({ clienteId }: { clienteId: string }) {
  const [state, formAction, isPending] = useActionState(lancarMovimentacaoCreditoCliente, null);
  const [tipo, setTipo] = useState("DEPOSITO");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="clienteId" value={clienteId} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Select
          label={
            <>
              Tipo
              <CampoAjuda texto="Depósito é quando o cliente adianta dinheiro pra usar depois. Estorno devolve um valor ao saldo dele (ex: pedido cancelado). Ajuste corrige o saldo manualmente pra mais ou menos. O crédito é abatido sozinho quando o cliente aprova um orçamento usando esse saldo — não precisa lançar isso aqui." />
            </>
          }
          name="tipo"
          defaultValue="DEPOSITO"
          onChange={(e) => setTipo(e.target.value)}
        >
          <option value="DEPOSITO">Depósito</option>
          <option value="ESTORNO">Estorno</option>
          <option value="AJUSTE">Ajuste</option>
        </Select>
        <Input label="Valor (R$)" name="valor" type="number" step="0.01" min="0.01" required />
        {tipo === "AJUSTE" ? (
          <Select label="Direção do ajuste" name="direcaoAjuste" defaultValue="AUMENTAR">
            <option value="AUMENTAR">Aumentar saldo</option>
            <option value="DIMINUIR">Diminuir saldo</option>
          </Select>
        ) : (
          <div />
        )}
        <Input
          label="Descrição (opcional)"
          name="descricao"
          placeholder="ex: depósito inicial combinado em contrato"
        />
      </div>
      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Lançando..." : "Lançar movimentação"}
      </Button>
    </form>
  );
}
