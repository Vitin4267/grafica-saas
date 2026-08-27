import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import {
  podeVerMeuNegocio,
  exigirVerModulo,
  podeEditarModulo,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { UsersIcon, SearchIcon, ArrowLeftIcon, ArrowRightIcon } from "@/components/icons";
import { ClienteForm } from "./ClienteForm";

const POR_PAGINA = 50;

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string }>;
}) {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CLIENTES");
  const podeEditar = await podeEditarModulo(usuario, "CLIENTES");

  const { q, pagina: paginaParam } = await searchParams;
  const busca = q?.trim();
  const paginaAtual = Math.max(1, Number(paginaParam) || 1);

  // Página de administração de clientes precisa enxergar os desativados
  // também (é aqui que dá pra reativar, ver ClienteEditForm) — diferente
  // dos dropdowns de seleção (orçamento, produção, relatórios), que filtram
  // desativadoEm: null. Busca e paginação, porém, valem só pra lista de
  // ativos (achado A13 da auditoria de abrangência: uma gráfica com
  // milhares de clientes não pode carregar tudo de uma vez) — a lista de
  // desativados continua completa dentro do <details>, que já é colapsado
  // por padrão e tende a ser pequena.
  const where = {
    graficaId: usuario.graficaId,
    desativadoEm: null,
    ...(busca
      ? {
          OR: [
            { nome: { contains: busca, mode: "insensitive" as const } },
            { documento: { contains: busca, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [clientes, totalClientes, clientesDesativados, totalGeral, vendedores] = await Promise.all([
    prisma.cliente.findMany({
      where,
      orderBy: { nome: "asc" },
      skip: (paginaAtual - 1) * POR_PAGINA,
      take: POR_PAGINA,
    }),
    prisma.cliente.count({ where }),
    prisma.cliente.findMany({
      where: { graficaId: usuario.graficaId, desativadoEm: { not: null } },
      orderBy: { desativadoEm: "desc" },
    }),
    prisma.cliente.count({ where: { graficaId: usuario.graficaId } }),
    // Achado A8 — lista fechada de usuários que podem ser atribuídos como
    // vendedor de um cliente: ativos da própria gráfica. Sem role
    // "vendedor" no sistema hoje, então lista todos (DONO/ADMIN/OPERADOR
    // podem todos vender, mesmo princípio de Usuario.comissaoPercent).
    prisma.usuario.findMany({
      where: { graficaId: usuario.graficaId, desativadoEm: null },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true },
    }),
  ]);

  const totalPaginas = Math.max(1, Math.ceil(totalClientes / POR_PAGINA));
  const construirLink = (pagina: number) => {
    const params = new URLSearchParams();
    if (busca) params.set("q", busca);
    if (pagina > 1) params.set("pagina", String(pagina));
    const query = params.toString();
    return query ? `/clientes?${query}` : "/clientes";
  };

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/clientes"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Clientes</h1>
          <p className="mt-1 text-slate-500">
            Cadastre seus clientes uma vez e reaproveite em todos os orçamentos.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
          {podeEditar && (
            <Card className="p-6 lg:col-span-2">
              <h2 className="mb-5 text-base font-semibold text-slate-900 dark:text-white">
                Novo cliente
              </h2>
              <ClienteForm vendedores={vendedores} />
            </Card>
          )}

          <div className={podeEditar ? "lg:col-span-3" : "lg:col-span-5"}>
            {totalGeral === 0 ? (
              <Card className="flex flex-col items-center gap-3 p-10 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
                  <UsersIcon className="h-6 w-6" />
                </span>
                <p className="text-sm text-slate-500">
                  Nenhum cliente cadastrado ainda. Use o formulário ao lado para
                  cadastrar o primeiro.
                </p>
              </Card>
            ) : (
              <div className="flex flex-col gap-4">
                <form className="flex items-end gap-3">
                  <div className="flex-1">
                    <Input
                      label="Buscar"
                      name="q"
                      defaultValue={busca ?? ""}
                      placeholder="Nome ou CPF/CNPJ..."
                      icon={<SearchIcon className="h-4 w-4" />}
                    />
                  </div>
                  <Button type="submit" variant="outline">
                    Buscar
                  </Button>
                  {busca && (
                    <Link
                      href="/clientes"
                      className="pb-2.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                    >
                      Limpar
                    </Link>
                  )}
                </form>

                {clientes.length === 0 ? (
                  <Card className="p-5 text-center text-sm text-slate-500">
                    {busca
                      ? "Nenhum cliente ativo encontrado com essa busca."
                      : "Nenhum cliente ativo. Veja os desativados abaixo."}
                  </Card>
                ) : (
                  <>
                    <Card className="divide-y divide-slate-100 dark:divide-slate-800">
                      {clientes.map((cliente) => (
                        <Link
                          key={cliente.id}
                          href={`/clientes/${cliente.id}`}
                          className="flex items-center gap-3 p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
                            <UsersIcon className="h-5 w-5" />
                          </span>
                          <div>
                            <p className="font-medium text-slate-900 dark:text-white">
                              {cliente.nome}
                            </p>
                            <p className="text-sm text-slate-500">
                              {[cliente.email, cliente.telefone].filter(Boolean).join(" · ") || "—"}
                            </p>
                          </div>
                        </Link>
                      ))}
                    </Card>

                    {totalPaginas > 1 && (
                      <div className="flex items-center justify-between text-sm text-slate-500">
                        <span>
                          Mostrando {(paginaAtual - 1) * POR_PAGINA + 1}–
                          {Math.min(paginaAtual * POR_PAGINA, totalClientes)} de {totalClientes}
                        </span>
                        <div className="flex items-center gap-2">
                          {paginaAtual > 1 ? (
                            <Link
                              href={construirLink(paginaAtual - 1)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                              <ArrowLeftIcon className="h-3.5 w-3.5" />
                              Anterior
                            </Link>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-300 dark:border-slate-800 dark:text-slate-700">
                              <ArrowLeftIcon className="h-3.5 w-3.5" />
                              Anterior
                            </span>
                          )}
                          <span className="text-xs">
                            Página {paginaAtual} de {totalPaginas}
                          </span>
                          {paginaAtual < totalPaginas ? (
                            <Link
                              href={construirLink(paginaAtual + 1)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                              Próxima
                              <ArrowRightIcon className="h-3.5 w-3.5" />
                            </Link>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-300 dark:border-slate-800 dark:text-slate-700">
                              Próxima
                              <ArrowRightIcon className="h-3.5 w-3.5" />
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {clientesDesativados.length > 0 && (
                  <details className="group rounded-xl border border-slate-200 dark:border-slate-800">
                    <summary className="cursor-pointer select-none list-none px-5 py-3 text-sm font-medium text-slate-500 marker:content-none">
                      Clientes desativados ({clientesDesativados.length})
                    </summary>
                    <div className="divide-y divide-slate-100 border-t border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                      {clientesDesativados.map((cliente) => (
                        <Link
                          key={cliente.id}
                          href={`/clientes/${cliente.id}`}
                          className="flex items-center gap-3 p-4 opacity-70 transition-colors hover:bg-slate-50 hover:opacity-100 dark:hover:bg-slate-800/50"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
                            <UsersIcon className="h-4 w-4" />
                          </span>
                          <div>
                            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                              {cliente.nome}
                            </p>
                            <p className="text-xs text-slate-400">
                              Desativado em{" "}
                              {cliente.desativadoEm!.toLocaleDateString("pt-BR")}
                            </p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
