"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { UsersIcon } from "@/components/icons";
import { ROTULO_PAPEL } from "@/lib/papel-usuario";
import { ORDEM_TIPO_CHAVE_PIX, ROTULO_TIPO_CHAVE_PIX } from "@/lib/tipos-grafica";
import { salvarDadosPagamentoUsuarios } from "./actions";
import type { TipoChavePix } from "@/generated/prisma/enums";

type PessoaPagamento = {
  id: string;
  nome: string;
  email: string;
  papel: string;
  cpf: string | null;
  chavePix: string | null;
  tipoChavePix: TipoChavePix | null;
  especialidade: string | null;
};

const inputClasse =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

// Achado D3 da auditoria de abrangência (Parte 7/Pessoas) — pra ONDE a
// gráfica paga cada usuário (comissão, freelancer), sentido OPOSTO da chave
// PIX da própria gráfica (Configurações > Identidade, achado F6). Só
// aparece pra quem tem a permissão FINANCEIRO — dado sensível, nunca exibido
// na listagem geral de usuários. Sem `podeEditar`: mostra os campos como
// texto simples (sem form) pra quem só tem "ver" de Financeiro.
export function DadosPagamentoUsuarioForm({
  usuarios,
  podeEditar,
}: {
  usuarios: PessoaPagamento[];
  podeEditar: boolean;
}) {
  const [state, formAction, isPending] = useActionState(salvarDadosPagamentoUsuarios, null);

  if (usuarios.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-sm text-slate-500">Você ainda não tem usuários cadastrados.</p>
      </Card>
    );
  }

  if (!podeEditar) {
    return (
      <Card className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
        {usuarios.map((u) => (
          <div key={u.id} className="flex flex-col gap-1 p-4 text-sm">
            <span className="font-medium text-slate-800 dark:text-slate-100">{u.nome}</span>
            <span className="text-xs text-slate-500">
              CPF: {u.cpf ?? "—"} · Chave PIX: {u.chavePix ?? "—"}
              {u.tipoChavePix ? ` (${ROTULO_TIPO_CHAVE_PIX[u.tipoChavePix]})` : ""} · Especialidade:{" "}
              {u.especialidade ?? "—"}
            </span>
          </div>
        ))}
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <form action={formAction} className="flex flex-col gap-5">
        <div className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {usuarios.map((u) => (
            <div key={u.id} className="flex flex-col gap-3 p-4">
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

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">CPF</span>
                  <input
                    type="text"
                    name={`cpf_${u.id}`}
                    defaultValue={u.cpf ?? ""}
                    placeholder="000.000.000-00"
                    aria-label={`CPF de ${u.nome}`}
                    className={inputClasse}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Chave PIX
                  </span>
                  <input
                    type="text"
                    name={`chavePix_${u.id}`}
                    defaultValue={u.chavePix ?? ""}
                    placeholder="CPF, e-mail, telefone..."
                    aria-label={`Chave PIX de ${u.nome}`}
                    className={inputClasse}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Tipo de chave
                  </span>
                  <select
                    name={`tipoChavePix_${u.id}`}
                    defaultValue={u.tipoChavePix ?? ""}
                    aria-label={`Tipo de chave PIX de ${u.nome}`}
                    className={inputClasse}
                  >
                    <option value="">Não informado</option>
                    {ORDEM_TIPO_CHAVE_PIX.map((valor) => (
                      <option key={valor} value={valor}>
                        {ROTULO_TIPO_CHAVE_PIX[valor]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Especialidade
                  </span>
                  <input
                    type="text"
                    name={`especialidade_${u.id}`}
                    defaultValue={u.especialidade ?? ""}
                    placeholder="ex: Motorista, Designer freelance"
                    aria-label={`Especialidade de ${u.nome}`}
                    className={inputClasse}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-500">
          Opcional — usado pra saber pra quem/onde pagar comissão ou serviço avulso. Não
          validamos o formato do CPF nem da chave PIX, e nada aqui confirma pagamento
          automaticamente.
        </p>

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar dados de pagamento"}
        </Button>
      </form>
    </Card>
  );
}
