"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { UsersIcon } from "@/components/icons";
import { salvarAcessoMeuNegocio } from "./actions";

// TODO(review): subconjunto duplicado do ROTULO_PAPEL de src/app/usuarios/page.tsx
// (mesma pasta, arquivo vizinho) — se o rótulo de um papel mudar, dá pra
// atualizar um e esquecer o outro. Valeria importar de um lugar só.
const ROTULO_PAPEL: Record<string, string> = {
  ADMIN: "Administrador",
  OPERADOR: "Operador",
};

type Funcionario = {
  id: string;
  nome: string;
  email: string;
  papel: string;
  acesso: boolean;
};

export function AcessoMeuNegocioForm({
  compartilhar: compartilharInicial,
  funcionarios,
}: {
  compartilhar: boolean;
  funcionarios: Funcionario[];
}) {
  const [compartilhar, setCompartilhar] = useState(compartilharInicial);
  const [state, formAction, isPending] = useActionState(salvarAcessoMeuNegocio, null);

  return (
    <Card className="p-6">
      <form action={formAction} className="flex flex-col gap-5">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="compartilhar"
            checked={compartilhar}
            onChange={(e) => setCompartilhar(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          <span>
            <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
              Compartilhar com a equipe
            </span>
            <span className="block text-xs text-slate-500">
              Liga o acesso ao relatório pra quem você marcar abaixo. Desligado,
              só você (dono) vê a aba — mas as marcações individuais ficam
              guardadas pra quando você ligar de novo.
            </span>
          </span>
        </label>

        {funcionarios.length === 0 ? (
          <p className="text-sm text-slate-500">
            Você ainda não tem outros usuários cadastrados. Crie um usuário
            acima para poder compartilhar o relatório com ele.
          </p>
        ) : (
          <div
            className={`flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200 transition-opacity dark:divide-slate-800 dark:border-slate-800 ${
              compartilhar ? "" : "pointer-events-none opacity-50"
            }`}
          >
            {funcionarios.map((f) => (
              <label
                key={f.id}
                className="flex items-center justify-between gap-3 p-4"
              >
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
                  name={`acesso_${f.id}`}
                  defaultChecked={f.acesso}
                  className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
              </label>
            ))}
          </div>
        )}

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar acesso"}
        </Button>
      </form>
    </Card>
  );
}
