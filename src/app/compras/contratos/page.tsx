import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import {
  podeVerMeuNegocio,
  podeVerModulo,
  podeEditarModulo,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { ArrowLeftIcon, AlertTriangleIcon, ReceiptIcon } from "@/components/icons";
import { formatoMoeda } from "@/lib/moeda";
import { formatoData } from "@/lib/data";
import { rotuloUnidadeCompra } from "@/lib/unidade-compra";
import { listarContratosProximosDoLimite } from "@/lib/contrato-fornecimento-db";
import { NovoContratoForm } from "./NovoContratoForm";

export default async function ContratosFornecimentoPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);

  const podeVer = await podeVerModulo(usuario, "COMPRAS");
  if (!podeVer) {
    redirect("/comecar");
  }
  const podeEditar = await podeEditarModulo(usuario, "COMPRAS");

  const [contratos, fornecedores, materiais, proximosDoLimite] = await Promise.all([
    prisma.contratoFornecimento.findMany({
      where: { graficaId: usuario.graficaId },
      include: {
        fornecedor: { select: { nome: true } },
        itemGrafica: { include: { itemCatalogo: { select: { nome: true } } } },
        variante: { select: { rotulo: true } },
      },
      orderBy: [{ ativo: "desc" }, { createdAt: "desc" }],
    }),
    prisma.fornecedor.findMany({
      where: { graficaId: usuario.graficaId, ativo: true },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true },
    }),
    prisma.itemGrafica.findMany({
      where: { graficaId: usuario.graficaId, ativo: true, itemCatalogo: { tipo: "MATERIA_PRIMA" } },
      include: { itemCatalogo: true, variantes: { where: { ativo: true }, orderBy: { rotulo: "asc" } } },
      orderBy: { itemCatalogo: { nome: "asc" } },
    }),
    listarContratosProximosDoLimite(usuario.graficaId),
  ]);

  const idsProximosDoLimite = new Set(proximosDoLimite.map((c) => c.id));

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/compras"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link
          href="/compras"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar pra Compras
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Contratos de fornecimento</h1>
          <p className="mt-1 text-slate-500">
            Preço fixo negociado com um fornecedor por um período — solicitações vinculadas nascem direto em
            &quot;Aprovado&quot;, sem passar por cotação.
          </p>
        </div>

        {proximosDoLimite.length > 0 && (
          <Card className="mb-8 divide-y divide-slate-100 dark:divide-slate-800">
            <div className="flex items-center gap-2 p-5 pb-3">
              <AlertTriangleIcon className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Contratos esgotando</h2>
            </div>
            {proximosDoLimite.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">
                    {c.fornecedorNome}
                    {c.itemNome ? ` — ${c.itemNome}` : " — qualquer item (coringa)"}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {c.vigenciaProxima &&
                      (c.diasRestantesVigencia >= 0
                        ? `Vigência acaba em ${c.diasRestantesVigencia} dia${c.diasRestantesVigencia === 1 ? "" : "s"} (${formatoData.format(c.vigenciaFim)})`
                        : `Vigência já venceu em ${formatoData.format(c.vigenciaFim)}`)}
                    {c.vigenciaProxima && c.quantidadeProxima ? " · " : ""}
                    {c.quantidadeProxima &&
                      `${Math.round((c.percentualConsumido ?? 0) * 100)}% da quantidade contratada já consumida`}
                  </p>
                </div>
              </div>
            ))}
          </Card>
        )}

        <div className="mb-8 flex flex-col gap-2">
          {contratos.length === 0 && (
            <Card className="p-5">
              <p className="text-sm text-slate-500">Nenhum contrato de fornecimento cadastrado ainda.</p>
            </Card>
          )}
          {contratos.map((contrato) => (
            <Link key={contrato.id} href={`/compras/contratos/${contrato.id}`}>
              <Card
                className={`flex items-center justify-between gap-4 p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                  idsProximosDoLimite.has(contrato.id) ? "border-amber-300 dark:border-amber-800" : ""
                }`}
              >
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">
                    {contrato.fornecedor.nome}
                    {contrato.itemGrafica ? ` — ${contrato.itemGrafica.itemCatalogo.nome}` : " — qualquer item"}
                    {contrato.variante ? ` (${contrato.variante.rotulo})` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {formatoMoeda.format(Number(contrato.precoUnitario))}/
                    {rotuloUnidadeCompra(contrato.unidadeCompra, contrato.unidadeCompraOutro)} · até{" "}
                    {formatoData.format(contrato.vigenciaFim)}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    contrato.ativo
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                  }`}
                >
                  {contrato.ativo ? "Ativo" : "Inativo"}
                </span>
              </Card>
            </Link>
          ))}
        </div>

        {podeEditar && (
          <Card className="p-6">
            <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
              <ReceiptIcon className="h-4 w-4" />
              Novo contrato
            </h2>
            <NovoContratoForm
              fornecedores={fornecedores}
              materiais={materiais.map((m) => ({
                id: m.id,
                nome: m.itemCatalogo.nome,
                variantes: m.variantes.map((v) => ({ id: v.id, rotulo: v.rotulo })),
              }))}
            />
          </Card>
        )}

        {podeEditar && fornecedores.length === 0 && (
          <p className="mt-3 text-center text-xs text-slate-500">
            <Link href="/configuracoes/fornecedores" className="font-medium text-teal-700 underline dark:text-teal-400">
              Cadastre um fornecedor
            </Link>{" "}
            antes de criar um contrato de fornecimento.
          </p>
        )}
      </main>
    </div>
  );
}
