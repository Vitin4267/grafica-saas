"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { editarFornecedor, alternarAtivoFornecedor } from "../actions";

export function FornecedorForm({
  fornecedorId,
  nome,
  contato,
  ativo,
}: {
  fornecedorId: string;
  nome: string;
  contato: string;
  ativo: boolean;
}) {
  const [state, formAction, isPending] = useActionState(editarFornecedor, null);
  const [estadoAtivo, alternarAction, alternandoPending] = useActionState(
    alternarAtivoFornecedor,
    null
  );

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="fornecedorId" value={fornecedorId} />
        <Card className="flex flex-col gap-4 p-6">
          <Input label="Nome" name="nome" type="text" defaultValue={nome} required />
          <Input label="Contato (opcional)" name="contato" type="text" defaultValue={contato} />
        </Card>
        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}
        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar"}
        </Button>
      </form>

      <Card className="flex items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-white">
            {ativo ? "Fornecedor ativo" : "Fornecedor inativo"}
          </p>
          <p className="text-xs text-slate-500">
            {ativo
              ? "Aparece pra seleção ao registrar uma entrada de compra, em Catálogo."
              : "Some da seleção ao registrar nova compra, mas compras já registradas com ele continuam no histórico. Nunca é excluído de verdade."}
          </p>
          {estadoAtivo && !estadoAtivo.ok && (
            <p className="mt-1 text-xs text-rose-600">{estadoAtivo.mensagem}</p>
          )}
        </div>
        <form action={alternarAction}>
          <input type="hidden" name="fornecedorId" value={fornecedorId} />
          <Button type="submit" variant="outline" loading={alternandoPending} className="shrink-0">
            {ativo ? "Desativar" : "Ativar"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
