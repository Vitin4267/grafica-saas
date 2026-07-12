import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeVerMeuNegocio, exigirVerModulo, obterModulosVisiveis } from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { ArrowLeftIcon } from "@/components/icons";

const LIMITE_REGISTROS = 200;

function chipEntidade(entidade: string) {
  const cores: Record<string, string> = {
    Despesa: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
    Pagamento: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  };
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${cores[entidade] ?? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}
    >
      {entidade}
    </span>
  );
}

export default async function AuditoriaPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "FINANCEIRO");

  const logs = await prisma.logAuditoria.findMany({
    where: { graficaId: usuario.graficaId },
    orderBy: { createdAt: "desc" },
    take: LIMITE_REGISTROS,
  });

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/financeiro"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link
          href="/financeiro"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar ao financeiro
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Trilha de auditoria
          </h1>
          <p className="mt-1 text-slate-500">
            Quem alterou o quê no financeiro — despesas e pagamentos. Mostrando os últimos{" "}
            {LIMITE_REGISTROS} registros.
          </p>
        </div>

        {logs.length === 0 ? (
          <Card className="p-10 text-center">
            <p className="text-sm text-slate-500">
              Nenhuma movimentação registrada ainda.
            </p>
          </Card>
        ) : (
          <Card className="divide-y divide-slate-100 dark:divide-slate-800">
            {logs.map((log) => (
              <div key={log.id} className="flex items-start justify-between gap-4 p-5">
                <div>
                  <p className="text-sm text-slate-900 dark:text-white">{log.descricao}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {log.usuarioNome} · {new Date(log.createdAt).toLocaleString("pt-BR")}
                  </p>
                </div>
                {chipEntidade(log.entidade)}
              </div>
            ))}
          </Card>
        )}
      </main>
    </div>
  );
}
