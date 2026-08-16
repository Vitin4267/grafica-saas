"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { UsersIcon } from "@/components/icons";
import { ROTULO_PAPEL } from "@/lib/papel-usuario";
import { salvarResponsaveisAdministrativo } from "./actions";

type Funcionario = {
  id: string;
  nome: string;
  email: string;
  papel: string;
  areas: string[];
};

// Hoje só existe uma AreaAdministrativa (NOTA_FISCAL, ver enum no
// schema.prisma) — por isso esta tela é uma lista simples de checkboxes, um
// por funcionário, em vez da tabela multi-coluna de ResponsaveisEstagioForm
// (que faz sentido lá porque ESTAGIOS_ATRIBUIVEIS já tem 3 valores hoje). No
// dia que uma segunda área administrativa existir, isto pode crescer pra uma
// tabela igual (uma coluna por área) — não vale construir isso agora (YAGNI).
export function ResponsaveisAdministrativoForm({ funcionarios }: { funcionarios: Funcionario[] }) {
  const [state, formAction, isPending] = useActionState(salvarResponsaveisAdministrativo, null);

  if (funcionarios.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-sm text-slate-500">
          Você ainda não tem outros usuários cadastrados. Crie um usuário
          acima pra poder atribuir essa responsabilidade a ele.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <form action={formAction} className="flex flex-col gap-5">
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {funcionarios.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 py-3">
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
              <input
                type="checkbox"
                name={`resp_${f.id}_NOTA_FISCAL`}
                defaultChecked={f.areas.includes("NOTA_FISCAL")}
                aria-label={`${f.nome} responsável pela emissão de Nota Fiscal`}
                className="h-4 w-4 shrink-0 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
            </li>
          ))}
        </ul>

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar responsáveis"}
        </Button>
      </form>
    </Card>
  );
}
