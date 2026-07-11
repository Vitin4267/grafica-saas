"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { MODULOS_PERMISSAO } from "@/lib/modulos-permissao";
import { salvarPermissoes } from "../../actions";

type ModuloValor = (typeof MODULOS_PERMISSAO)[number]["valor"];

type LinhaPermissao = { modulo: ModuloValor; podeVer: boolean; podeEditar: boolean };

export function PermissoesForm({
  usuarioId,
  permissoesIniciais,
}: {
  usuarioId: string;
  permissoesIniciais: LinhaPermissao[];
}) {
  const [state, formAction, isPending] = useActionState(salvarPermissoes, null);

  const [permissoes, setPermissoes] = useState<Record<ModuloValor, { ver: boolean; editar: boolean }>>(
    () =>
      Object.fromEntries(
        MODULOS_PERMISSAO.map(({ valor }) => {
          const existente = permissoesIniciais.find((p) => p.modulo === valor);
          return [valor, { ver: existente?.podeVer ?? false, editar: existente?.podeEditar ?? false }];
        })
      ) as Record<ModuloValor, { ver: boolean; editar: boolean }>
  );

  function alternarVer(modulo: ModuloValor, ver: boolean) {
    setPermissoes((atual) => ({
      ...atual,
      // Desmarcar "ver" também desmarca "editar" — não faz sentido editar o
      // que não pode nem ver.
      [modulo]: { ver, editar: ver ? atual[modulo].editar : false },
    }));
  }

  function alternarEditar(modulo: ModuloValor, editar: boolean) {
    setPermissoes((atual) => ({ ...atual, [modulo]: { ...atual[modulo], editar } }));
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="usuarioId" value={usuarioId} />

      <Card className="divide-y divide-slate-100 dark:divide-slate-800">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 p-4 text-xs font-medium uppercase tracking-wide text-slate-400">
          <span>Tela</span>
          <span>Ver</span>
          <span>Editar</span>
        </div>
        {MODULOS_PERMISSAO.map(({ valor, rotulo }) => (
          <div key={valor} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 p-4">
            <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{rotulo}</span>
            <input
              type="checkbox"
              name={`ver_${valor}`}
              checked={permissoes[valor].ver}
              onChange={(e) => alternarVer(valor, e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <input
              type="checkbox"
              name={`editar_${valor}`}
              checked={permissoes[valor].editar}
              disabled={!permissoes[valor].ver}
              onChange={(e) => alternarEditar(valor, e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 disabled:opacity-30"
            />
          </div>
        ))}
      </Card>

      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Salvando..." : "Salvar permissões"}
      </Button>
    </form>
  );
}
