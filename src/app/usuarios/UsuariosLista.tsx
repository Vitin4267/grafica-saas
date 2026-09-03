"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { UsersIcon } from "@/components/icons";
import { ROTULO_PAPEL } from "@/lib/papel-usuario";
import { desativarUsuario, reativarUsuario } from "./actions";
import { PerfilAcessoCell } from "./PerfilAcessoCell";

type FuncionarioAtivo = {
  id: string;
  nome: string;
  email: string;
  papel: string;
  // Achado A5 da auditoria de abrangência — só é lido/mostrado pra OPERADOR
  // (ver PerfilAcessoCell); DONO/ADMIN sempre têm o campo, mas ignoram.
  perfilAcessoId: string | null;
};

type FuncionarioDesativado = FuncionarioAtivo & {
  // ISO string — Date não atravessa a fronteira Server→Client Component.
  desativadoEm: string;
};

// Lista de funcionários da tela /usuarios: ativos com botão "Remover"
// (desativa, não apaga — ver comentário de Usuario.desativadoEm no schema) e,
// numa seção separada e recolhida, os já removidos com botão "Reativar".
// Extraído do page.tsx porque as duas Server Actions (desativarUsuario/
// reativarUsuario) precisam de useActionState, e page.tsx é Server Component.
export function UsuariosLista({
  usuariosAtivos,
  usuariosDesativados,
  perfisAcesso,
}: {
  usuariosAtivos: FuncionarioAtivo[];
  usuariosDesativados: FuncionarioDesativado[];
  perfisAcesso: { id: string; nome: string }[];
}) {
  const [estadoDesativar, desativarAction, desativando] = useActionState(desativarUsuario, null);
  const [estadoReativar, reativarAction, reativando] = useActionState(reativarUsuario, null);
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);

  // Mesmo padrão de PrensaForm.tsx: só fecha a confirmação em caso de erro —
  // em caso de sucesso a linha some da lista sozinha (revalidatePath), não
  // precisa fechar nada.
  useAoMudar(estadoDesativar, (estado) => {
    if (estado && !estado.ok) setConfirmandoId(null);
  });

  return (
    <div className="flex flex-col gap-4">
      <Card className="divide-y divide-slate-100 dark:divide-slate-800">
        {usuariosAtivos.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
                <UsersIcon className="h-5 w-5" />
              </span>
              <div>
                <p className="font-medium text-slate-900 dark:text-white">{u.nome}</p>
                <p className="text-sm text-slate-500">{u.email}</p>
              </div>
            </div>

            {confirmandoId === u.id ? (
              <ConfirmarExclusao
                pergunta={`Remover "${u.nome}"? Ele perde o acesso na hora. O histórico dele (orçamentos, comissões, auditoria) continua intacto, e dá pra reativar depois.`}
                onCancelar={() => setConfirmandoId(null)}
                formAction={desativarAction}
                campos={{ usuarioId: u.id }}
                rotuloBotao="Remover"
                pendente={desativando}
              />
            ) : (
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {ROTULO_PAPEL[u.papel] ?? u.papel}
                </span>
                {u.papel === "OPERADOR" ? (
                  <>
                    {perfisAcesso.length > 0 && (
                      <PerfilAcessoCell
                        usuarioId={u.id}
                        perfilAcessoIdAtual={u.perfilAcessoId}
                        perfis={perfisAcesso}
                      />
                    )}
                    <Link
                      href={`/usuarios/${u.id}/permissoes`}
                      className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
                    >
                      Permissões
                    </Link>
                  </>
                ) : u.papel === "ADMIN" ? (
                  <span className="text-xs text-slate-400">Acesso total</span>
                ) : null}
                {u.papel !== "DONO" && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                    onClick={() => setConfirmandoId(u.id)}
                  >
                    Remover
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </Card>

      {estadoDesativar && !estadoDesativar.ok && <Alert variant="error">{estadoDesativar.mensagem}</Alert>}

      {usuariosDesativados.length > 0 && (
        <details className="group rounded-xl border border-slate-200 dark:border-slate-800">
          <summary className="cursor-pointer select-none list-none px-5 py-3 text-sm font-medium text-slate-500 marker:content-none">
            Funcionários removidos ({usuariosDesativados.length})
          </summary>
          <div className="divide-y divide-slate-100 border-t border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {usuariosDesativados.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{u.nome}</p>
                  <p className="text-xs text-slate-400">
                    {u.email} · removido em {new Date(u.desativadoEm).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <form action={reativarAction}>
                  <input type="hidden" name="usuarioId" value={u.id} />
                  <Button type="submit" variant="outline" loading={reativando}>
                    Reativar
                  </Button>
                </form>
              </div>
            ))}
          </div>
        </details>
      )}

      {estadoReativar && !estadoReativar.ok && <Alert variant="error">{estadoReativar.mensagem}</Alert>}
    </div>
  );
}
