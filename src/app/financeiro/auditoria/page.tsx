import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeVerMeuNegocio, exigirVerModulo, obterModulosVisiveis } from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ArrowLeftIcon } from "@/components/icons";
import { formatoInstanteRealComHora, limitesDiaBrasilia } from "@/lib/data";

const LIMITE_REGISTROS = 200;

const CORES_ENTIDADE: Record<string, string> = {
  Despesa: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
  Pagamento: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  Comissao: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  Usuario: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300",
  Grafica: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300",
  ItemCatalogo: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  ItemGrafica: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  VarianteMateriaPrima: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  ParametrosGrafica: "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  Orcamento: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

function chipEntidade(entidade: string) {
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${CORES_ENTIDADE[entidade] ?? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}
    >
      {entidade}
    </span>
  );
}

export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<{ usuarioId?: string; de?: string; ate?: string }>;
}) {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "FINANCEIRO");

  const { usuarioId, de, ate } = await searchParams;

  const [logs, funcionarios] = await Promise.all([
    prisma.logAuditoria.findMany({
      where: {
        graficaId: usuario.graficaId,
        ...(usuarioId ? { usuarioId } : {}),
        ...(de || ate
          ? {
              createdAt: {
                ...(de ? { gte: limitesDiaBrasilia(de).inicio } : {}),
                ...(ate ? { lt: limitesDiaBrasilia(ate).fim } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: LIMITE_REGISTROS,
    }),
    // Lista pra popular o filtro — inclui todo mundo que já existiu na
    // gráfica, não só quem tem log (evita a lista "sumir" um funcionário
    // assim que ele é removido, o que seria o pior momento pra perder o
    // filtro por ele).
    prisma.usuario.findMany({
      where: { graficaId: usuario.graficaId },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
  ]);

  const filtrosAtivos = Boolean(usuarioId || de || ate);

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
            Quem mudou o quê na gráfica — financeiro, catálogo, usuários e configurações.
            Mostrando os últimos {LIMITE_REGISTROS} registros{filtrosAtivos ? " que batem com o filtro" : ""}.
          </p>
        </div>

        <form className="mb-6 flex flex-wrap items-end gap-3">
          <div className="min-w-[180px] flex-1">
            <Select label="Funcionário" name="usuarioId" defaultValue={usuarioId ?? ""}>
              <option value="">Todos</option>
              {funcionarios.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-40">
            <Input label="De" type="date" name="de" defaultValue={de ?? ""} />
          </div>
          <div className="w-40">
            <Input label="Até" type="date" name="ate" defaultValue={ate ?? ""} />
          </div>
          <Button type="submit" variant="outline">
            Filtrar
          </Button>
          {filtrosAtivos && (
            <Link
              href="/financeiro/auditoria"
              className="text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              Limpar filtros
            </Link>
          )}
        </form>

        {logs.length === 0 ? (
          <Card className="p-10 text-center">
            <p className="text-sm text-slate-500">
              {filtrosAtivos
                ? "Nenhuma movimentação encontrada com esse filtro."
                : "Nenhuma movimentação registrada ainda."}
            </p>
          </Card>
        ) : (
          <Card className="divide-y divide-slate-100 dark:divide-slate-800">
            {logs.map((log) => (
              <div key={log.id} className="flex items-start justify-between gap-4 p-5">
                <div>
                  <p className="text-sm text-slate-900 dark:text-white">{log.descricao}</p>
                  {(log.valorAnterior || log.valorNovo) && (
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                      {log.valorAnterior ?? "—"}
                      {" → "}
                      {log.valorNovo ?? "—"}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-500">
                    {log.usuarioNome} · {formatoInstanteRealComHora.format(log.createdAt)}
                    {log.ip ? ` · IP ${log.ip}` : ""}
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
