"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import {
  GradePermissoesModulo,
  permissoesIniciaisPorModulo,
  alternarVerPermissao,
  alternarEditarPermissao,
  type ModuloValorPermissao,
} from "@/components/GradePermissoesModulo";
import { salvarPermissoes } from "../../actions";

type LinhaPermissao = { modulo: ModuloValorPermissao; podeVer: boolean; podeEditar: boolean };

export function PermissoesForm({
  usuarioId,
  permissoesIniciais,
}: {
  usuarioId: string;
  permissoesIniciais: LinhaPermissao[];
}) {
  const [state, formAction, isPending] = useActionState(salvarPermissoes, null);
  const [permissoes, setPermissoes] = useState(() => permissoesIniciaisPorModulo(permissoesIniciais));

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="usuarioId" value={usuarioId} />

      <GradePermissoesModulo
        permissoes={permissoes}
        onAlternarVer={(modulo, ver) => setPermissoes((atual) => alternarVerPermissao(atual, modulo, ver))}
        onAlternarEditar={(modulo, editar) =>
          setPermissoes((atual) => alternarEditarPermissao(atual, modulo, editar))
        }
      />

      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Salvando..." : "Salvar permissões"}
      </Button>
    </form>
  );
}
