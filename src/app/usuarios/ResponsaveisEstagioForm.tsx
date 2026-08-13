"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { UsersIcon } from "@/components/icons";
import { ROTULO_PAPEL } from "@/lib/papel-usuario";
import { ESTAGIOS_ATRIBUIVEIS } from "@/lib/producao-estagios";
import { salvarResponsaveisEstagio } from "./actions";

type Funcionario = {
  id: string;
  nome: string;
  email: string;
  papel: string;
  etapas: string[];
};

export function ResponsaveisEstagioForm({ funcionarios }: { funcionarios: Funcionario[] }) {
  const [state, formAction, isPending] = useActionState(salvarResponsaveisEstagio, null);

  if (funcionarios.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-sm text-slate-500">
          Você ainda não tem outros usuários cadastrados. Crie um usuário
          acima pra poder atribuir uma etapa a ele.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <form action={formAction} className="flex flex-col gap-5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse">
            <thead>
              <tr>
                <th className="pb-3 text-left text-xs font-medium text-slate-500">Funcionário</th>
                {ESTAGIOS_ATRIBUIVEIS.map((estagio) => (
                  <th key={estagio.valor} className="pb-3 text-center text-xs font-medium text-slate-500">
                    {estagio.rotulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {funcionarios.map((f) => (
                <tr key={f.id}>
                  <td className="py-3">
                    <span className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        <UsersIcon className="h-4 w-4" />
                      </span>
                      <span>
                        <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
                          {f.nome}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {f.email} · {ROTULO_PAPEL[f.papel] ?? f.papel}
                        </span>
                      </span>
                    </span>
                  </td>
                  {ESTAGIOS_ATRIBUIVEIS.map((estagio) => (
                    <td key={estagio.valor} className="py-3 text-center">
                      <input
                        type="checkbox"
                        name={`resp_${f.id}_${estagio.valor}`}
                        defaultChecked={f.etapas.includes(estagio.valor)}
                        className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar responsáveis"}
        </Button>
      </form>
    </Card>
  );
}
