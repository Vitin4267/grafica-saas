"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { UserIcon, MailIcon } from "@/components/icons";
import { criarUsuario } from "./actions";

type PerfilOpcao = { id: string; nome: string };

// Feature "multi-cargo" (2026-09-06) — checkbox múltiplo dos cargos
// (PerfilAcesso, pré-semeados + customizados) da gráfica, direto na criação
// do usuário: elimina o passo separado de ir em PerfilAcessoCell depois só
// pra dar acesso a alguém recém-criado. Só tem efeito de verdade pra papel
// OPERADOR (ver resolverPermissaoOperador) — marcar um cargo com Papel
// "Administrador" escolhido abaixo não quebra nada, só fica sem uso.
export function UsuarioForm({ perfisAcesso }: { perfisAcesso: PerfilOpcao[] }) {
  const [state, formAction, isPending] = useActionState(criarUsuario, null);
  const [resetKey, setResetKey] = useState(0);
  const [estadoAnterior, setEstadoAnterior] = useState(state);

  // Mesmo padrão de reset pós-sucesso do ClienteForm — form de criar-novo-
  // registro, precisa limpar os campos não-controlados depois de cada envio.
  if (state !== estadoAnterior) {
    setEstadoAnterior(state);
    if (state?.ok) setResetKey((k) => k + 1);
  }

  return (
    <form key={resetKey} action={formAction} className="flex flex-col gap-4">
      <Input label="Nome" name="nome" required icon={<UserIcon className="h-4 w-4" />} />
      <Input
        label="E-mail"
        name="email"
        type="email"
        required
        icon={<MailIcon className="h-4 w-4" />}
      />
      <PasswordInput
        label="Senha inicial"
        name="senha"
        required
        minLength={10}
        hint="Mínimo 10 caracteres, com letra maiúscula, minúscula e número."
      />
      <Select label="Papel" name="papel" required defaultValue="OPERADOR">
        <option value="OPERADOR">Operador</option>
        <option value="ADMIN">Administrador</option>
      </Select>

      {perfisAcesso.length > 0 && (
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
            Cargos (opcional)
          </span>
          <div className="flex flex-col gap-1.5 rounded-xl border border-slate-300 p-3 dark:border-slate-700">
            {perfisAcesso.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"
              >
                <input
                  type="checkbox"
                  name="perfilAcessoId"
                  value={p.id}
                  className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                {p.nome}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Só tem efeito se o papel escolhido acima for Operador — dá pra
            marcar mais de um.
          </p>
        </div>
      )}

      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Criando..." : "Criar usuário"}
      </Button>
    </form>
  );
}
