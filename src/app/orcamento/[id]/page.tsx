import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import {
  podeVerMeuNegocio,
  exigirVerModulo,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { resolverOrigemPublica } from "@/lib/url-publica";
import { buscarCustoRealVsOrcado } from "@/lib/custo-producao";
import { verificarProntidaoFiscal } from "@/lib/nota-fiscal";
import { formatoMoeda } from "@/lib/moeda";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { ArrowLeftIcon } from "@/components/icons";
import { OrcamentoAcoes } from "./OrcamentoAcoes";
import { EditarOrcamentoForm } from "./EditarOrcamentoForm";
import { AdicionarItemForm } from "./AdicionarItemForm";
import { TrocarClienteForm } from "./TrocarClienteForm";
import { CompartilharOrcamento } from "./CompartilharOrcamento";
import { PagamentosCard } from "./PagamentosCard";
import { CustoProducaoCard } from "./CustoProducaoCard";
import { NotaFiscalCard } from "./NotaFiscalCard";

export default async function OrcamentoDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const usuario = await exigirUsuarioAutenticado();
  await exigirVerModulo(usuario, "ORCAMENTO");
  const origem = await resolverOrigemPublica();

  const [orcamento, clientes, itensVendaveis] = await Promise.all([
    prisma.orcamento.findFirst({
      where: { id, graficaId: usuario.graficaId },
      include: {
        cliente: true,
        pedido: true,
        notaFiscal: true,
        itens: { include: { itemGrafica: { include: { itemCatalogo: true } } } },
        pagamentos: { orderBy: { createdAt: "desc" } },
      },
    }),
    prisma.cliente.findMany({
      where: { graficaId: usuario.graficaId },
      orderBy: { nome: "asc" },
    }),
    prisma.itemGrafica.findMany({
      where: { graficaId: usuario.graficaId, ativo: true, precoVenda: { not: null } },
      include: { itemCatalogo: true },
      orderBy: { itemCatalogo: { nome: "asc" } },
    }),
  ]);

  if (!orcamento) {
    notFound();
  }

  const custoComparado = orcamento.pedido
    ? await buscarCustoRealVsOrcado(orcamento.pedido.id, usuario.graficaId)
    : null;

  let checagemFiscal: { pronto: boolean; pendencias: string[] } | null = null;
  if (orcamento.status === "APROVADO" && !orcamento.notaFiscal) {
    const dadosFiscais = await prisma.dadosFiscaisGrafica.findUnique({
      where: { graficaId: usuario.graficaId },
    });
    checagemFiscal = verificarProntidaoFiscal({
      dadosFiscais,
      cliente: orcamento.cliente,
      itens: orcamento.itens.map((item) => ({
        nome: item.itemGrafica.itemCatalogo.nome,
        ncm: item.itemGrafica.itemCatalogo.ncm,
      })),
    });
  }

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/orcamento"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link
          href="/orcamento"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar aos orçamentos
        </Link>

        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              {orcamento.cliente.nome}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Criado em {orcamento.createdAt.toLocaleDateString("pt-BR")}
            </p>
            {orcamento.status === "RASCUNHO" && (
              <div className="mt-2">
                <TrocarClienteForm
                  orcamentoId={orcamento.id}
                  clienteAtualId={orcamento.clienteId}
                  clientes={clientes}
                />
              </div>
            )}
          </div>
          <StatusBadge status={orcamento.status} />
        </div>

        {orcamento.status === "RASCUNHO" ? (
          <div className="mb-6 flex flex-col gap-4">
            {orcamento.itens.map((item) => (
              <EditarOrcamentoForm
                key={item.id}
                orcamentoId={orcamento.id}
                orcamentoItemId={item.id}
                itemNome={item.itemGrafica.itemCatalogo.nome}
                modeloCalculo={item.modeloCalculo}
                podeRemover={orcamento.itens.length > 1}
                valoresIniciais={{
                  quantidade: item.quantidade,
                  larguraCm: item.larguraCm?.toString() ?? "",
                  alturaCm: item.alturaCm?.toString() ?? "",
                  cores: item.cores ?? "",
                  acabamento: item.acabamento ?? "",
                  corFrente: item.corFrente?.toString() ?? "",
                  corVerso: item.corVerso?.toString() ?? "",
                }}
              />
            ))}
            <AdicionarItemForm
              orcamentoId={orcamento.id}
              itens={itensVendaveis.map((ig) => ({
                id: ig.id,
                nome: ig.itemCatalogo.nome,
                categoria: ig.itemCatalogo.categoria,
                precoVenda: ig.precoVenda!.toString(),
                modeloCalculo: ig.modeloCalculo,
              }))}
            />
          </div>
        ) : (
          <Card className="mb-6 divide-y divide-slate-100 dark:divide-slate-800">
            {orcamento.itens.map((item) => (
              <div key={item.id} className="flex flex-col gap-2 p-5">
                <div className="flex items-center justify-between gap-4">
                  <p className="font-medium text-slate-900 dark:text-white">
                    {item.itemGrafica.itemCatalogo.nome}
                  </p>
                  <p className="font-semibold text-slate-900 dark:text-white">
                    {formatoMoeda.format(Number(item.precoTotal))}
                  </p>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>Qtd: {item.quantidade}</span>
                  {item.larguraCm && item.alturaCm && (
                    <span>
                      {Number(item.larguraCm)} × {Number(item.alturaCm)} cm
                    </span>
                  )}
                  {item.cores && <span>Cores: {item.cores}</span>}
                  {item.corFrente !== null && (
                    <span>
                      Frente/verso: {item.corFrente}x{item.corVerso ?? 0}
                    </span>
                  )}
                  {item.acabamento && <span>Acabamento: {item.acabamento}</span>}
                  <span>Unitário: {formatoMoeda.format(Number(item.precoUnitario))}</span>
                </div>
              </div>
            ))}
          </Card>
        )}

        <Card className="mb-6 flex items-center justify-between p-5">
          <p className="text-sm font-medium text-slate-500">Total do orçamento</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            {formatoMoeda.format(Number(orcamento.total))}
          </p>
        </Card>

        <Card className="mb-6 p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-500">
              Compartilhar com o cliente
            </p>
            <a
              href={`/orcamento/${orcamento.id}/pdf`}
              className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
            >
              Baixar PDF
            </a>
          </div>
          <CompartilharOrcamento
            orcamentoId={orcamento.id}
            linkExistente={
              orcamento.linkPublicoToken ? `${origem}/o/${orcamento.linkPublicoToken}` : null
            }
            clienteNome={orcamento.cliente.nome}
            clienteTelefone={orcamento.cliente.telefone}
            graficaNome={usuario.grafica.nome}
          />
        </Card>

        <PagamentosCard
          orcamentoId={orcamento.id}
          total={Number(orcamento.total)}
          pagamentos={orcamento.pagamentos.map((p) => ({
            id: p.id,
            valor: p.valor.toString(),
            forma: p.forma,
            observacao: p.observacao,
            createdAt: p.createdAt.toISOString(),
          }))}
          podeRegistrar={orcamento.status === "APROVADO"}
        />

        {orcamento.pedido && (
          <Link href="/producao" className="mb-6 block">
            <Card className="flex items-center justify-between p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Pedido de produção gerado — ver acompanhamento
              </p>
              <StatusBadge status={orcamento.pedido.status} tipo="pedido" />
            </Card>
          </Link>
        )}

        {custoComparado && custoComparado.itens.length > 0 && (
          <CustoProducaoCard comparacao={custoComparado} />
        )}

        {orcamento.status === "APROVADO" && (
          <NotaFiscalCard
            orcamentoId={orcamento.id}
            notaFiscal={orcamento.notaFiscal}
            pendencias={checagemFiscal?.pendencias ?? []}
          />
        )}

        <OrcamentoAcoes orcamentoId={orcamento.id} status={orcamento.status} />
      </main>
    </div>
  );
}
