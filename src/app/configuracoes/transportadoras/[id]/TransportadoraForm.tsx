"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { editarTransportadora, alternarAtivaTransportadora } from "../actions";

export function TransportadoraForm({
  transportadoraId,
  nome,
  telefone,
  email,
  documento,
  rntrc,
  ativa,
}: {
  transportadoraId: string;
  nome: string;
  telefone: string;
  email: string;
  documento: string;
  rntrc: string;
  ativa: boolean;
}) {
  const [state, formAction, isPending] = useActionState(editarTransportadora, null);
  const [estadoAtiva, alternarAction, alternandoPending] = useActionState(
    alternarAtivaTransportadora,
    null
  );

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="transportadoraId" value={transportadoraId} />
        <Card className="flex flex-col gap-4 p-6">
          <Input label="Nome" name="nome" type="text" defaultValue={nome} required />
          <Input label="Telefone (opcional)" name="telefone" type="text" defaultValue={telefone} />
          <Input label="E-mail (opcional)" name="email" type="email" defaultValue={email} />
        </Card>
        <Card className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Dados fiscais e de transporte (opcional)
            </h2>
            <p className="text-xs text-slate-500">
              CNPJ/CPF e RNTRC (Registro Nacional de Transportadores Rodoviários de Cargas) — úteis
              pra referência, sem uso automático na NF-e ainda.
            </p>
          </div>
          <Input label="CPF/CNPJ" name="documento" defaultValue={documento} placeholder="opcional" />
          <Input label="RNTRC" name="rntrc" defaultValue={rntrc} placeholder="opcional" />
        </Card>
        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}
        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar"}
        </Button>
      </form>

      <Card className="flex items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-white">
            {ativa ? "Transportadora ativa" : "Transportadora inativa"}
          </p>
          <p className="text-xs text-slate-500">
            {ativa
              ? "Aparece pra seleção ao preencher o frete de um orçamento."
              : "Some da seleção pra novo uso, mas orçamentos/entregas já vinculados continuam no histórico. Nunca é excluída de verdade."}
          </p>
          {estadoAtiva && !estadoAtiva.ok && (
            <p className="mt-1 text-xs text-rose-600">{estadoAtiva.mensagem}</p>
          )}
        </div>
        <form action={alternarAction}>
          <input type="hidden" name="transportadoraId" value={transportadoraId} />
          <Button type="submit" variant="outline" loading={alternandoPending} className="shrink-0">
            {ativa ? "Desativar" : "Ativar"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
