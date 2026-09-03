"use client";

import { useActionState } from "react";
import { Select } from "@/components/ui/Select";
import { salvarPerfilUsuario } from "./actions";

type PerfilOpcao = { id: string; nome: string };

// Achado A5 da auditoria de abrangência (Parte 6/Configurações,
// pesquisa-abrangencia-modulos.md, 2026-08-27) — select de perfil de acesso
// por linha de OPERADOR em /usuarios, ao lado do link "Permissões" (override
// individual). Auto-salva no onChange (mesmo espírito de instantâneo dos
// botões Remover/Reativar da lista) em vez de exigir um botão "Salvar"
// separado — é um componente próprio (não inline no .map de UsuariosLista)
// porque cada linha precisa do próprio useActionState.
export function PerfilAcessoCell({
  usuarioId,
  perfilAcessoIdAtual,
  perfis,
}: {
  usuarioId: string;
  perfilAcessoIdAtual: string | null;
  perfis: PerfilOpcao[];
}) {
  const [state, formAction, isPending] = useActionState(salvarPerfilUsuario, null);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="usuarioId" value={usuarioId} />
      <Select
        label={<span className="sr-only">Perfil de acesso</span>}
        name="perfilAcessoId"
        defaultValue={perfilAcessoIdAtual ?? ""}
        disabled={isPending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="!py-1.5 !pr-8 !pl-2.5 text-xs"
      >
        <option value="">Sem perfil</option>
        {perfis.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nome}
          </option>
        ))}
      </Select>
      {state && !state.ok && <span className="text-xs text-rose-600">{state.mensagem}</span>}
    </form>
  );
}
