"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { UsersIcon } from "@/components/icons";
import { ROTULO_PAPEL } from "@/lib/papel-usuario";
import { salvarComissaoUsuarios } from "./actions";

type Vendedor = {
  id: string;
  nome: string;
  email: string;
  papel: string;
  comissaoPercent: string; // já formatado como string vazia ou "0.05"
};

export function ComissaoUsuarioForm({ usuarios }: { usuarios: Vendedor[] }) {
  const [state, formAction, isPending] = useActionState(salvarComissaoUsuarios, null);

  return (
    <Card className="p-6">
      <form action={formAction} className="flex flex-col gap-5">
        {usuarios.length === 0 ? (
          <p className="text-sm text-slate-500">
            Você ainda não tem usuários cadastrados.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {usuarios.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-3 p-4">
                <span className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    <UsersIcon className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
                      {u.nome}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {u.email} · {ROTULO_PAPEL[u.papel] ?? u.papel}
                    </span>
                  </span>
                </span>
                <input
                  type="number"
                  name={`percentual_${u.id}`}
                  defaultValue={u.comissaoPercent}
                  step="0.0001"
                  min="0"
                  max="1"
                  placeholder="0.00"
                  aria-label={`Comissão de ${u.nome}`}
                  className="w-24 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-slate-500">
          Percentual sobre o valor-base definido em Configurações (ex: 0.05 = 5%). Vazio = não recebe comissão.
        </p>

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar comissões"}
        </Button>
      </form>
    </Card>
  );
}
