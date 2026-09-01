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
import { ArrowLeftIcon } from "@/components/icons";
import { rotuloTipoFerramental, ROTULO_STATUS_FERRAMENTAL } from "@/lib/tipos-ferramental";
import { NovoFerramentalForm } from "./NovoFerramentalForm";

export default async function FerramentaisPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");
  const podeEditar = await podeEditarModulo(usuario, "CONFIGURACOES");

  const [ferramentais, clientes, itensGrafica] = await Promise.all([
    prisma.ferramental.findMany({
      where: { graficaId: usuario.graficaId },
      include: {
        cliente: { select: { nome: true } },
        itemGrafica: { include: { itemCatalogo: { select: { nome: true } } } },
      },
      orderBy: [{ desativadoEm: "asc" }, { codigo: "asc" }],
    }),
    prisma.cliente.findMany({
      where: { graficaId: usuario.graficaId, desativadoEm: null },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
    // Ferramental produz um PRODUTO específico do catálogo (não uma
    // matéria-prima) — mesmo raciocínio de filtro do contrato de
    // fornecimento (que filtra MATERIA_PRIMA), aqui o universo é o oposto.
    prisma.itemGrafica.findMany({
      where: { graficaId: usuario.graficaId, ativo: true, itemCatalogo: { tipo: "PRODUTO" } },
      include: { itemCatalogo: { select: { nome: true } } },
      orderBy: { itemCatalogo: { nome: "asc" } },
    }),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/configuracoes"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link
          href="/configuracoes"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar a Configurações
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Ferramentais</h1>
          <p className="mt-1 text-slate-500">
            Faca de corte e vinco, clichê de flexo/hot stamping, tela de
            serigrafia, matriz de bordado... a ferramenta física em si, não só
            o custo dela. Cadastro informativo — vincular um item de orçamento
            a um ferramental já existente não muda preço nenhum
            automaticamente, é só pra lembrar que a ferramenta já existe.
          </p>
        </div>

        <div className="mb-8 flex flex-col gap-2">
          {ferramentais.length === 0 && (
            <Card className="p-5">
              <p className="text-sm text-slate-500">
                Nenhum ferramental cadastrado ainda — crie o primeiro abaixo.
              </p>
            </Card>
          )}
          {ferramentais.map((ferramental) => (
            <Link key={ferramental.id} href={`/configuracoes/ferramentais/${ferramental.id}`}>
              <Card className="flex items-center justify-between gap-4 p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">
                    {ferramental.codigo}
                    <span className="ml-2 font-normal text-slate-500">
                      {rotuloTipoFerramental(ferramental.tipo, ferramental.tipoOutro)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {ferramental.proprietario === "CLIENTE" && ferramental.cliente
                      ? `Do cliente ${ferramental.cliente.nome}`
                      : "Da gráfica"}
                    {ferramental.itemGrafica ? ` · ${ferramental.itemGrafica.itemCatalogo.nome}` : ""}
                    {ferramental.localizacao ? ` · ${ferramental.localizacao}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      ferramental.status === "ATIVO"
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                        : ferramental.status === "EM_MANUTENCAO"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                          : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                    }`}
                  >
                    {ROTULO_STATUS_FERRAMENTAL[ferramental.status]}
                  </span>
                  {ferramental.desativadoEm && (
                    <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-600 dark:bg-rose-950/50 dark:text-rose-300">
                      Desativado
                    </span>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>

        {podeEditar && (
          <Card className="p-6">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
              Novo ferramental
            </h2>
            <NovoFerramentalForm
              clientes={clientes}
              itensGrafica={itensGrafica.map((item) => ({ id: item.id, nome: item.itemCatalogo.nome }))}
            />
          </Card>
        )}
      </main>
    </div>
  );
}
