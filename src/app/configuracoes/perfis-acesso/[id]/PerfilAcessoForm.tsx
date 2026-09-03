"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import {
  GradePermissoesModulo,
  permissoesIniciaisPorModulo,
  alternarVerPermissao,
  alternarEditarPermissao,
  type ModuloValorPermissao,
} from "@/components/GradePermissoesModulo";
import { editarPerfilAcesso, excluirPerfilAcesso } from "../actions";

type LinhaPermissao = { modulo: ModuloValorPermissao; podeVer: boolean; podeEditar: boolean };
type UsuarioSimples = { id: string; nome: string };

export function PerfilAcessoForm({
  perfilId,
  nomeInicial,
  permissoesIniciais,
  usuariosComEstePerfil,
}: {
  perfilId: string;
  nomeInicial: string;
  permissoesIniciais: LinhaPermissao[];
  usuariosComEstePerfil: UsuarioSimples[];
}) {
  const [state, formAction, isPending] = useActionState(editarPerfilAcesso, null);
  const [estadoExcluir, excluirAction, excluindo] = useActionState(excluirPerfilAcesso, null);
  const [permissoes, setPermissoes] = useState(() => permissoesIniciaisPorModulo(permissoesIniciais));

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-6">
        <input type="hidden" name="perfilId" value={perfilId} />

        <Card className="p-6">
          <Input label="Nome do perfil" name="nome" defaultValue={nomeInicial} required />
        </Card>

        <GradePermissoesModulo
          permissoes={permissoes}
          onAlternarVer={(modulo, ver) => setPermissoes((atual) => alternarVerPermissao(atual, modulo, ver))}
          onAlternarEditar={(modulo, editar) =>
            setPermissoes((atual) => alternarEditarPermissao(atual, modulo, editar))
          }
        />

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar perfil"}
        </Button>
      </form>

      <Card className="flex flex-col gap-3 p-5">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-white">
            {usuariosComEstePerfil.length === 0
              ? "Nenhum usuário com este perfil"
              : `${usuariosComEstePerfil.length} usuário(s) com este perfil`}
          </p>
          {usuariosComEstePerfil.length > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              {usuariosComEstePerfil.map((u) => u.nome).join(", ")} — atribua ou
              troque o perfil de cada um em{" "}
              <Link href="/usuarios" className="underline">
                Usuários
              </Link>
              .
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">Excluir perfil</p>
            <p className="text-xs text-slate-500">
              {usuariosComEstePerfil.length > 0
                ? "Troque o perfil de todo mundo que usa este perfil antes de excluir."
                : "Não pode ser desfeito. Só é possível enquanto nenhum usuário estiver usando este perfil."}
            </p>
            {estadoExcluir && !estadoExcluir.ok && (
              <p className="mt-1 text-xs text-rose-600">{estadoExcluir.mensagem}</p>
            )}
          </div>
          <form action={excluirAction}>
            <input type="hidden" name="perfilId" value={perfilId} />
            <Button
              type="submit"
              variant="outline"
              loading={excluindo}
              disabled={usuariosComEstePerfil.length > 0}
              className="shrink-0 text-rose-600"
            >
              Excluir
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
